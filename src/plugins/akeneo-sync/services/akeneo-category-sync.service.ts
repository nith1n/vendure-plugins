import { Injectable, OnModuleInit } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Collection,
    CollectionService,
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
import { In } from 'typeorm';

import { AkeneoApiError } from '../akeneo/akeneo-api-client';
import { AkeneoCategory, AkeneoLabels } from '../akeneo/akeneo-types';
import { loggerCtx } from '../constants';

import { AkeneoApiService } from './akeneo-api.service';
import { AkeneoConnectionSettingsService } from './akeneo-connection-settings.service';

interface CategorySyncJobData {
    ctx: SerializedRequestContext;
    /** `next` URL of the previous page; null for the first page. */
    cursor: string | null;
    page: number;
}

export interface CategorySyncPageResult {
    page: number;
    categories: number;
    created: number;
    updated: number;
    unchanged: number;
    /** Parents referenced before their own page was synced; filled in when it arrives. */
    placeholders: number;
    hasNextPage: boolean;
}

interface ExistingCollection {
    id: ID;
    parentId: ID;
    names: Map<LanguageCode, string>;
}

const JOB_RETRIES = 3;

/**
 * Syncs Akeneo category trees to Vendure Collections, one Akeneo page per job. Each job
 * enqueues the next page, so a large catalog never runs as one long job and a failing
 * page is retried on its own.
 *
 * Root categories become top-level Collections. Collections are matched on the
 * `akeneoCode` custom field; names are kept in sync, slugs are only set on creation so
 * that storefront URLs stay stable.
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
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: 'akeneo-category-sync',
            process: job => this.syncPage(job.data),
        });
    }

    async startSync(ctx: RequestContext) {
        await this.assertEnabled(ctx);
        return this.queue.add({ ctx: ctx.serialize(), cursor: null, page: 1 }, { retries: JOB_RETRIES });
    }

    private async syncPage(data: CategorySyncJobData): Promise<CategorySyncPageResult> {
        const ctx = RequestContext.deserialize(data.ctx);
        await this.assertEnabled(ctx);

        const client = await this.akeneoApiService.getClient(ctx);
        const page = data.cursor
            ? await client.getPage<AkeneoCategory>(data.cursor)
            : await client.categories();

        const counts = await this.connection.withTransaction(ctx, txCtx =>
            this.upsertCategories(txCtx, page.items),
        );

        if (page.next) {
            await this.queue.add(
                { ctx: data.ctx, cursor: page.next, page: data.page + 1 },
                { retries: JOB_RETRIES },
            );
        } else {
            Logger.info(`Akeneo category sync finished after ${data.page} page(s)`, loggerCtx);
        }
        return { page: data.page, categories: page.items.length, ...counts, hasNextPage: !!page.next };
    }

    private async upsertCategories(ctx: RequestContext, categories: AkeneoCategory[]) {
        const counts = { created: 0, updated: 0, unchanged: 0, placeholders: 0 };
        const byCode = new Map(categories.map(c => [c.code, c]));
        const referenced = categories.flatMap(c => (c.parent ? [c.code, c.parent] : [c.code]));
        const existing = await this.findByAkeneoCodes(ctx, [...new Set(referenced)]);
        const rootId = await this.getRootCollectionId(ctx);
        const done = new Set<string>();

        const resolveParentId = async (parentCode: string | null): Promise<ID> => {
            if (!parentCode) return rootId;
            const parentInPage = byCode.get(parentCode);
            if (parentInPage && !done.has(parentCode)) await upsert(parentInPage);
            const found = existing.get(parentCode);
            if (found) return found.id;
            if (parentInPage) {
                throw new AkeneoApiError(`Akeneo category "${parentCode}" is its own ancestor`, null);
            }
            // Parent is on a later page: create it now, its real data updates it then
            const placeholder = await this.create(ctx, parentCode, {}, rootId);
            existing.set(parentCode, placeholder);
            counts.placeholders++;
            return placeholder.id;
        };

        const upsert = async (category: AkeneoCategory): Promise<void> => {
            done.add(category.code);
            const parentId = await resolveParentId(category.parent);
            const current = existing.get(category.code);
            if (!current) {
                existing.set(category.code, await this.create(ctx, category.code, category.labels, parentId));
                counts.created++;
                return;
            }
            const changed = await this.update(ctx, current, category, parentId);
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
    ): Promise<ExistingCollection> {
        const translations = this.namesFromLabels(ctx, code, labels);
        const collection = await this.collectionService.create(ctx, {
            parentId,
            filters: [],
            translations: [...translations].map(([languageCode, name]) => ({
                languageCode,
                name,
                slug: name,
                description: '',
            })),
            customFields: { akeneoCode: code },
        });
        return { id: collection.id, parentId, names: translations };
    }

    /** Returns false when nothing changed, to avoid needless collection events. */
    private async update(
        ctx: RequestContext,
        current: ExistingCollection,
        category: AkeneoCategory,
        parentId: ID,
    ): Promise<boolean> {
        const names = this.namesFromLabels(ctx, category.code, category.labels);
        const changedNames = [...names].filter(([lang, name]) => current.names.get(lang) !== name);
        const moved = !idsAreEqual(current.parentId, parentId);

        if (changedNames.length) {
            await this.collectionService.update(ctx, {
                id: current.id,
                translations: changedNames.map(([languageCode, name]) =>
                    // New languages need a slug; existing ones keep theirs
                    current.names.has(languageCode)
                        ? { languageCode, name }
                        : { languageCode, name, slug: name, description: '' },
                ),
            });
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
        return changedNames.length > 0 || moved;
    }

    /**
     * One name per channel language that Akeneo has a label for. The default language always
     * gets a name, falling back to any label and then to the category code.
     */
    private namesFromLabels(ctx: RequestContext, code: string, labels: AkeneoLabels) {
        const available = Object.entries(labels).filter((e): e is [string, string] => !!e[1]?.trim());
        const pick = (lang: string) =>
            available.find(([locale]) => locale === lang)?.[1] ??
            available.find(([locale]) => locale.split('_')[0] === lang.split('_')[0])?.[1];

        const names = new Map<LanguageCode, string>();
        for (const lang of ctx.channel.availableLanguageCodes ?? []) {
            const label = pick(lang);
            if (label) names.set(lang, label.trim());
        }
        const defaultLang = ctx.channel.defaultLanguageCode;
        if (!names.has(defaultLang)) names.set(defaultLang, (available[0]?.[1] ?? code).trim());
        return names;
    }

    private async findByAkeneoCodes(ctx: RequestContext, codes: string[]) {
        const collections = await this.connection.getRepository(ctx, Collection).find({
            where: { customFields: { akeneoCode: In(codes) } },
            relations: ['translations'],
        });
        return new Map(
            collections.map(c => [
                c.customFields.akeneoCode as string,
                {
                    id: c.id,
                    parentId: c.parentId,
                    names: new Map(c.translations.map(t => [t.languageCode, t.name])),
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

    private async assertEnabled(ctx: RequestContext) {
        const settings = await this.connectionSettingsService.findForChannel(ctx);
        if (!settings) throw new UserInputError('No Akeneo connection is configured for this channel');
        if (!settings.enabled) throw new UserInputError('Akeneo sync is disabled for this channel');
    }
}
