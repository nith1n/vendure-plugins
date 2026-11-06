import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigurableOperationInput, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Collection,
    CollectionService,
    ConfigService,
    ID,
    idsAreEqual,
    JobQueue,
    JobQueueService,
    Logger,
    RequestContext,
    SerializedRequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'crypto';
import { In } from 'typeorm';

import { AkeneoApiError } from '../akeneo/akeneo-api-client';
import { AkeneoCategory, AkeneoLabels } from '../akeneo/akeneo-types';
import { AKENEO_CATEGORY_FILTER_CODE } from '../config/akeneo-category-collection-filter';
import { CATEGORY_SYNC_QUEUE, CLEANUP_QUEUE, loggerCtx } from '../constants';
import { AkeneoLocaleMapping } from '../entities/akeneo-connection-settings.entity';
import {
    errorText,
    findChannelJobs,
    assertNoActiveRun,
    runState,
    SyncRunJobData,
    SyncRunState,
} from '../utils/sync-runs';

import { AkeneoApiService } from './akeneo-api.service';
import { AkeneoConnectionSettingsService } from './akeneo-connection-settings.service';

// Type aliases (not interfaces) so they satisfy the job queue's JsonCompatible data constraint
type CategorySyncTotals = {
    pages: number;
    categories: number;
    created: number;
    updated: number;
    unchanged: number;
};

export interface CategorySyncJobData extends SyncRunJobData {
    ctx: SerializedRequestContext;
    /** Totals of the pages before this one, carried forward so the latest job describes the run. */
    totals: CategorySyncTotals;
    /** Settings snapshot taken when the run starts, so a run stays consistent if they change. */
    trees: string[];
    includeRoot: boolean;
    localeMapping: AkeneoLocaleMapping[];
    treeIndex: number;
    /** `next` URL of the previous page of the current tree; null for its first page. */
    cursor: string | null;
    page: number;
}

export interface CategorySyncPageResult {
    tree: string;
    page: number;
    categories: number;
    created: number;
    updated: number;
    unchanged: number;
    /** Parents referenced before their own page was synced; filled in when it arrives. */
    placeholders: number;
    hasNextPage: boolean;
    /** Totals of the run up to and including this page. */
    totals: CategorySyncTotals;
}

export interface CategorySyncStatus extends CategorySyncTotals {
    runId: string;
    state: SyncRunState;
    trees: string[];
    currentTree: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    error: string | null;
}

interface ExistingCollection {
    id: ID;
    parentId: ID;
    names: Map<LanguageCode, string>;
    /** Whether it already selects its variants with the Akeneo category filter. */
    hasCategoryFilter: boolean;
    /** Filters added by hand, kept when the Akeneo category filter is (re)applied. */
    otherFilters: ConfigurableOperationInput[];
}

interface TreeContext {
    rootCode: string;
    includeRoot: boolean;
    localeMapping: AkeneoLocaleMapping[];
}

const QUEUE_NAME = CATEGORY_SYNC_QUEUE;
const JOB_RETRIES = 3;
const EMPTY_TOTALS: CategorySyncTotals = { pages: 0, categories: 0, created: 0, updated: 0, unchanged: 0 };

/**
 * Syncs the selected Akeneo category trees to Vendure Collections, one Akeneo page per job.
 * Each job enqueues the next page (or the next tree), so a large catalog never runs as one
 * long job and a failing page is retried on its own.
 *
 * Each Vendure channel owns its own Collections, matched on `akeneoCode` + `akeneoChannelId`.
 * Tree roots only become Collections when `includeCategoryRoot` is set; otherwise their
 * children are top-level. Names follow the configured locale mapping; slugs are only set on
 * creation so that storefront URLs stay stable.
 */
@Injectable()
export class AkeneoCategorySyncService implements OnModuleInit {
    private queue: JobQueue<CategorySyncJobData>;

    constructor(
        private connection: TransactionalConnection,
        private collectionService: CollectionService,
        private jobQueueService: JobQueueService,
        private akeneoApiService: AkeneoApiService,
        private connectionSettingsService: AkeneoConnectionSettingsService,
        private configService: ConfigService,
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: QUEUE_NAME,
            process: job => this.syncPage(job.data),
        });
    }

    async startSync(ctx: RequestContext) {
        const settings = await this.connectionSettingsService.findForChannel(ctx);
        if (!settings) throw new UserInputError('No Akeneo connection is configured for this channel');
        if (!settings.enabled) throw new UserInputError('Akeneo sync is disabled for this channel');
        if (!settings.channelCode) throw new UserInputError('Select an Akeneo channel first');
        if (!settings.categoryTreeCodes.length) {
            throw new UserInputError('Select at least one category tree to sync');
        }
        const defaultLanguage = ctx.channel.defaultLanguageCode;
        if (!settings.localeMapping.some(m => m.languageCode === defaultLanguage)) {
            throw new UserInputError(`Map an Akeneo locale to the default language "${defaultLanguage}"`);
        }
        await assertNoActiveRun(this.configService, ctx, [QUEUE_NAME, CLEANUP_QUEUE]);

        return this.queue.add(
            {
                ctx: ctx.serialize(),
                channelId: String(ctx.channelId),
                runId: randomUUID(),
                startedAt: new Date().toISOString(),
                totals: EMPTY_TOTALS,
                trees: settings.categoryTreeCodes,
                includeRoot: settings.includeCategoryRoot,
                localeMapping: settings.localeMapping,
                treeIndex: 0,
                cursor: null,
                page: 1,
            },
            { retries: JOB_RETRIES },
        );
    }

    private async syncPage(data: CategorySyncJobData): Promise<CategorySyncPageResult> {
        const ctx = RequestContext.deserialize(data.ctx);
        const settings = await this.connectionSettingsService.findForChannel(ctx);
        if (!settings?.enabled) throw new UserInputError('Akeneo sync is disabled for this channel');

        const rootCode = data.trees[data.treeIndex];
        const client = await this.akeneoApiService.getClient(ctx);
        const page = data.cursor
            ? await client.getPage<AkeneoCategory>(data.cursor)
            : await client.categoryTreeDescendants(rootCode);
        // The descendants query excludes the root, so add it to the tree's first page
        const categories =
            data.includeRoot && !data.cursor ? [await client.category(rootCode), ...page.items] : page.items;

        const tree: TreeContext = {
            rootCode,
            includeRoot: data.includeRoot,
            localeMapping: data.localeMapping,
        };
        const counts = await this.connection.withTransaction(ctx, txCtx =>
            this.upsertCategories(txCtx, categories, tree),
        );

        const totals: CategorySyncTotals = {
            pages: data.totals.pages + 1,
            categories: data.totals.categories + categories.length,
            created: data.totals.created + counts.created,
            updated: data.totals.updated + counts.updated,
            unchanged: data.totals.unchanged + counts.unchanged,
        };
        const next: Partial<CategorySyncJobData> | undefined = page.next
            ? { cursor: page.next, page: data.page + 1 }
            : data.treeIndex + 1 < data.trees.length
              ? { treeIndex: data.treeIndex + 1, cursor: null, page: 1 }
              : undefined;
        if (next) {
            await this.queue.add({ ...data, ...next, totals }, { retries: JOB_RETRIES });
        } else {
            Logger.info(`Akeneo category sync finished (${data.trees.join(', ')})`, loggerCtx);
        }
        return {
            tree: rootCode,
            page: data.page,
            categories: categories.length,
            ...counts,
            hasNextPage: !!page.next,
            totals,
        };
    }

    /** Status of this channel's latest run; see `utils/sync-runs.ts` for how runs are tracked. */
    async getStatus(ctx: RequestContext): Promise<CategorySyncStatus | null> {
        const [latest] = await findChannelJobs<CategorySyncJobData>(this.configService, ctx, QUEUE_NAME);
        if (!latest) return null;
        const data = latest.data;
        const result = latest.result as CategorySyncPageResult | undefined;
        const state = runState(latest);
        return {
            runId: data.runId,
            state,
            trees: data.trees,
            currentTree: state === 'RUNNING' ? data.trees[data.treeIndex] : null,
            ...(result?.totals ?? data.totals),
            startedAt: new Date(data.startedAt),
            finishedAt: state === 'RUNNING' ? null : (latest.settledAt ?? null),
            error: state === 'FAILED' ? errorText(latest.error) : null,
        };
    }

    private async upsertCategories(ctx: RequestContext, categories: AkeneoCategory[], tree: TreeContext) {
        const counts = { created: 0, updated: 0, unchanged: 0, placeholders: 0 };
        const byCode = new Map(categories.map(c => [c.code, c]));
        const referenced = categories.flatMap(c => (c.parent ? [c.code, c.parent] : [c.code]));
        const existing = await this.findByAkeneoCodes(ctx, [...new Set(referenced)]);
        const rootId = await this.getRootCollectionId(ctx);
        const done = new Set<string>();

        const resolveParentId = async (parentCode: string | null): Promise<ID> => {
            // Without the tree root as a Collection, its children are top-level
            if (!parentCode || (parentCode === tree.rootCode && !tree.includeRoot)) return rootId;
            const parentInPage = byCode.get(parentCode);
            if (parentInPage && !done.has(parentCode)) await upsert(parentInPage);
            const found = existing.get(parentCode);
            if (found) return found.id;
            if (parentInPage) {
                throw new AkeneoApiError(`Akeneo category "${parentCode}" is its own ancestor`, null);
            }
            // Parent is on a later page: create it now, its real data updates it then
            const placeholder = await this.create(ctx, parentCode, {}, rootId, tree);
            existing.set(parentCode, placeholder);
            counts.placeholders++;
            return placeholder.id;
        };

        const upsert = async (category: AkeneoCategory): Promise<void> => {
            done.add(category.code);
            const parentId = await resolveParentId(category.parent);
            const current = existing.get(category.code);
            if (!current) {
                existing.set(
                    category.code,
                    await this.create(ctx, category.code, category.labels, parentId, tree),
                );
                counts.created++;
                return;
            }
            const changed = await this.update(ctx, current, category, parentId, tree);
            counts[changed ? 'updated' : 'unchanged']++;
        };

        for (const category of categories) {
            if (!done.has(category.code)) await upsert(category);
        }
        return counts;
    }

    private async create(
        ctx: RequestContext,
        code: string,
        labels: AkeneoLabels,
        parentId: ID,
        tree: TreeContext,
    ): Promise<ExistingCollection> {
        const translations = this.namesFromLabels(ctx, code, labels, tree.localeMapping);
        const collection = await this.collectionService.create(ctx, {
            parentId,
            filters: [categoryFilter(code)],
            // The filter already includes descendants; inheriting would also require the parent's code
            inheritFilters: false,
            translations: [...translations].map(([languageCode, name]) => ({
                languageCode,
                name,
                slug: name,
                description: '',
            })),
            customFields: { akeneoCode: code, akeneoChannelId: String(ctx.channelId) },
        });
        return {
            id: collection.id,
            parentId,
            names: translations,
            hasCategoryFilter: true,
            otherFilters: [],
        };
    }

    /** Returns false when nothing changed, to avoid needless collection events. */
    private async update(
        ctx: RequestContext,
        current: ExistingCollection,
        category: AkeneoCategory,
        parentId: ID,
        tree: TreeContext,
    ): Promise<boolean> {
        const names = this.namesFromLabels(ctx, category.code, category.labels, tree.localeMapping);
        const changedNames = [...names].filter(([lang, name]) => current.names.get(lang) !== name);
        const moved = !idsAreEqual(current.parentId, parentId);
        const filterMissing = !current.hasCategoryFilter;

        if (changedNames.length || filterMissing) {
            await this.collectionService.update(ctx, {
                id: current.id,
                translations: changedNames.map(([languageCode, name]) =>
                    // New languages need a slug; existing ones keep theirs
                    current.names.has(languageCode)
                        ? { languageCode, name }
                        : { languageCode, name, slug: name, description: '' },
                ),
                ...(filterMissing
                    ? {
                          filters: [categoryFilter(category.code), ...current.otherFilters],
                          inheritFilters: false,
                      }
                    : {}),
            });
            current.hasCategoryFilter = true;
        }
        if (moved) {
            await this.collectionService.move(ctx, {
                collectionId: current.id,
                parentId,
                index: Number.MAX_SAFE_INTEGER,
            });
        }
        current.names = new Map([...current.names, ...names]);
        current.parentId = parentId;
        return changedNames.length > 0 || moved || filterMissing;
    }

    /**
     * One name per mapped language that Akeneo has a label for. The default language always
     * gets a name, falling back to the category code.
     */
    private namesFromLabels(
        ctx: RequestContext,
        code: string,
        labels: AkeneoLabels,
        localeMapping: AkeneoLocaleMapping[],
    ) {
        const available = new Set(ctx.channel.availableLanguageCodes ?? []);
        const names = new Map<LanguageCode, string>();
        for (const { languageCode, locale } of localeMapping) {
            const label = labels[locale]?.trim();
            if (label && available.has(languageCode)) names.set(languageCode, label);
        }
        const defaultLang = ctx.channel.defaultLanguageCode;
        if (!names.has(defaultLang)) names.set(defaultLang, code);
        return names;
    }

    private async findByAkeneoCodes(ctx: RequestContext, codes: string[]) {
        const collections = await this.connection.getRepository(ctx, Collection).find({
            where: { customFields: { akeneoCode: In(codes), akeneoChannelId: String(ctx.channelId) } },
            relations: ['translations'],
        });
        return new Map(
            collections.map(c => [
                c.customFields.akeneoCode as string,
                {
                    id: c.id,
                    parentId: c.parentId,
                    names: new Map(c.translations.map(t => [t.languageCode, t.name])),
                    hasCategoryFilter:
                        !c.inheritFilters &&
                        c.filters.some(
                            f =>
                                f.code === AKENEO_CATEGORY_FILTER_CODE &&
                                f.args.some(
                                    a => a.name === 'categoryCode' && a.value === c.customFields.akeneoCode,
                                ),
                        ),
                    otherFilters: c.filters
                        .filter(f => f.code !== AKENEO_CATEGORY_FILTER_CODE)
                        .map(f => ({ code: f.code, arguments: f.args })),
                },
            ]),
        );
    }

    private async getRootCollectionId(ctx: RequestContext): Promise<ID> {
        const root = await this.connection
            .getRepository(ctx, Collection)
            .findOneOrFail({ where: { isRoot: true }, select: ['id'] });
        return root.id;
    }
}

function categoryFilter(code: string): ConfigurableOperationInput {
    return {
        code: AKENEO_CATEGORY_FILTER_CODE,
        arguments: [
            { name: 'categoryCode', value: code },
            { name: 'combineWithAnd', value: 'true' },
        ],
    };
}
