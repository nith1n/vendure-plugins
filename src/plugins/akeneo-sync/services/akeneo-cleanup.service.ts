import { Injectable, OnModuleInit } from '@nestjs/common';
import {
    Asset,
    AssetService,
    ChannelService,
    Collection,
    CollectionAsset,
    CollectionService,
    ConfigService,
    ID,
    idsAreEqual,
    isInspectableJobQueueStrategy,
    JobQueue,
    JobQueueService,
    Logger,
    Product,
    ProductAsset,
    ProductService,
    ProductVariant,
    ProductVariantAsset,
    ProductVariantService,
    RequestContext,
    SerializedRequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { JobState } from '@vendure/common/lib/generated-types';
import { randomUUID } from 'crypto';
import { In, IsNull, Not } from 'typeorm';

import { AkeneoApiClient } from '../akeneo/akeneo-api-client';
import { findMainIdentifierAttribute } from '../akeneo/akeneo-lookups';
import {
    ASSET_SYNC_QUEUE,
    CATEGORY_SYNC_QUEUE,
    CLEANUP_QUEUE,
    loggerCtx,
    PRODUCT_SYNC_QUEUE,
} from '../constants';
import { AkeneoConnectionSettings } from '../entities/akeneo-connection-settings.entity';
import { AkeneoVariantCategory } from '../entities/akeneo-variant-category.entity';
import {
    assertNoActiveRun,
    errorText,
    findChannelJobs,
    runState,
    SyncRunJobData,
    SyncRunState,
} from '../utils/sync-runs';

import { AkeneoApiService } from './akeneo-api.service';
import { AkeneoConnectionSettingsService } from './akeneo-connection-settings.service';

// Type aliases (not interfaces) so they satisfy the job queue's JsonCompatible data constraint
type CleanupKind = {
    /** What to remove; for collections only the top-most, which take their descendants along. */
    ids: string[];
    /** How many items each id removes: 1, or a collection and its descendants. */
    sizes: number[];
    /** A few names, for the preview. */
    examples: string[];
};

type CleanupKept = { kind: string; name: string; reason: string };

export type CleanupPlan = {
    products: CleanupKind;
    /** Stale variants of products that stay (other variants are still in Akeneo). */
    variants: CleanupKind;
    collections: CleanupKind;
    assets: CleanupKind;
    kept: CleanupKept[];
};

export type CleanupRemoved = { products: number; variants: number; collections: number; assets: number };

type CleanupJobData = SyncRunJobData & {
    ctx: SerializedRequestContext;
    mode: 'scan' | 'remove';
    /** The scan whose plan a remove job carries out. */
    scanJobId: string | null;
};

type CleanupJobResult = { plan: CleanupPlan; removed: CleanupRemoved | null };

export interface CleanupStatus {
    jobId: ID;
    mode: 'SCAN' | 'REMOVE';
    state: SyncRunState;
    startedAt: Date;
    finishedAt: Date | null;
    error: string | null;
    plan: CleanupPlan | null;
    removed: CleanupRemoved | null;
}

const KINDS = ['products', 'variants', 'collections', 'assets'] as const;
const MAX_EXAMPLES = 5;

/**
 * Finds what the sync created that Akeneo no longer has, and removes it on request:
 *
 * - Products and variants no longer among the Akeneo channel's products (soft-deleted, so orders
 *   keep working). A product goes when all its synced variants are gone from Akeneo.
 * - Collections of categories that are no longer synced (deselected trees, deleted categories).
 *   Only whole subtrees owned by this channel's sync; collections added by hand are never removed.
 * - Akeneo images that no product, variant or collection uses any more.
 *
 * Removal always follows a scan the admin has seen, and only removes what a fresh scan still finds.
 */
@Injectable()
export class AkeneoCleanupService implements OnModuleInit {
    private queue: JobQueue<CleanupJobData>;

    constructor(
        private connection: TransactionalConnection,
        private jobQueueService: JobQueueService,
        private configService: ConfigService,
        private channelService: ChannelService,
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private collectionService: CollectionService,
        private assetService: AssetService,
        private akeneoApiService: AkeneoApiService,
        private connectionSettingsService: AkeneoConnectionSettingsService,
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: CLEANUP_QUEUE,
            process: job => this.process(job.data),
        });
    }

    async startScan(ctx: RequestContext) {
        await this.requireSettings(ctx);
        await this.assertIdle(ctx);
        return this.queue.add(this.jobData(ctx, 'scan', null));
    }

    async startRemove(ctx: RequestContext, scanJobId: ID) {
        await this.requireSettings(ctx);
        await this.assertIdle(ctx);
        const scan = await this.findScan(ctx, scanJobId);
        if (!scan) throw new UserInputError('Find leftovers again before removing them');
        return this.queue.add(this.jobData(ctx, 'remove', String(scanJobId)));
    }

    async getStatus(ctx: RequestContext): Promise<CleanupStatus | null> {
        const [latest] = await findChannelJobs<CleanupJobData>(this.configService, ctx, CLEANUP_QUEUE);
        if (!latest?.id) return null;
        const result = latest.result as CleanupJobResult | undefined;
        const state = runState(latest);
        return {
            jobId: latest.id,
            mode: latest.data.mode === 'scan' ? 'SCAN' : 'REMOVE',
            state,
            startedAt: new Date(latest.data.startedAt),
            finishedAt: state === 'RUNNING' ? null : (latest.settledAt ?? null),
            error: state === 'FAILED' ? errorText(latest.error) : null,
            plan: result?.plan ?? null,
            removed: result?.removed ?? null,
        };
    }

    private async process(data: CleanupJobData): Promise<CleanupJobResult> {
        const ctx = RequestContext.deserialize(data.ctx);
        const plan = await this.scan(ctx);
        if (data.mode === 'scan') return { plan, removed: null };

        // Only what the admin saw and a fresh scan still finds
        const scan = data.scanJobId ? await this.findScan(ctx, data.scanJobId) : undefined;
        if (!scan) throw new UserInputError('The scan to remove was not found');
        const confirmed = intersect(plan, scan.plan);
        const removed = await this.remove(ctx, confirmed);
        return { plan: confirmed, removed };
    }

    private async scan(ctx: RequestContext): Promise<CleanupPlan> {
        const settings = await this.requireSettings(ctx);
        const client = await this.akeneoApiService.getClient(ctx);
        const plan: CleanupPlan = {
            products: emptyKind(),
            variants: emptyKind(),
            collections: emptyKind(),
            assets: emptyKind(),
            kept: [],
        };
        await this.scanProducts(ctx, client, settings, plan);
        await this.scanCollections(ctx, client, settings, plan);
        await this.scanAssets(ctx, plan);
        return plan;
    }

    private async scanProducts(
        ctx: RequestContext,
        client: AkeneoApiClient,
        settings: AkeneoConnectionSettings,
        plan: CleanupPlan,
    ) {
        const channelCode = settings.channelCode as string;
        let categoryTree: string | undefined;
        for await (const page of client.pages(await client.channels())) {
            categoryTree ??= page.items.find(c => c.code === channelCode)?.category_tree;
        }
        if (!categoryTree) throw new UserInputError(`Akeneo channel "${channelCode}" does not exist`);

        // The same selection as the product sync; only the identifier value is needed
        const identifier = await findMainIdentifierAttribute(client);
        const live = new Set<string>();
        const first = await client.products({
            search: { categories: [{ operator: 'IN CHILDREN', value: [categoryTree] }] },
            scope: channelCode,
            ...(identifier ? { attributes: [identifier] } : {}),
        });
        for await (const page of client.pages(first)) {
            for (const product of page.items) live.add(product.uuid);
        }

        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: {
                deletedAt: IsNull(),
                customFields: { akeneoUuid: Not(IsNull()) },
                channels: { id: ctx.channelId },
            },
            relations: ['product', 'product.channels', 'product.translations', 'product.variants'],
        });
        if (!live.size && variants.length) {
            throw new UserInputError(
                `Akeneo returned no products for channel "${channelCode}", so nothing was marked. ` +
                    'Check the Akeneo channel and its category tree.',
            );
        }

        const stale = variants.filter(v => !live.has(v.customFields.akeneoUuid as string));
        const staleIds = new Set(stale.map(v => String(v.id)));
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const byProduct = new Map<string, ProductVariant[]>();
        for (const variant of stale) {
            const key = String(variant.productId);
            byProduct.set(key, [...(byProduct.get(key) ?? []), variant]);
        }
        for (const [productId, productStale] of byProduct) {
            const product = productStale[0].product;
            const name = translatedName(product, ctx);
            const otherChannels = product.channels.filter(
                c => !idsAreEqual(c.id, ctx.channelId) && !idsAreEqual(c.id, defaultChannel.id),
            );
            if (otherChannels.length) {
                plan.kept.push({
                    kind: 'product',
                    name,
                    reason: `Also in channel ${otherChannels.map(c => c.code).join(', ')}`,
                });
                continue;
            }
            const remaining = product.variants.filter(v => !v.deletedAt && !staleIds.has(String(v.id)));
            if (remaining.length) {
                for (const variant of productStale)
                    add(plan.variants, variant.id, `${name} (${variant.sku})`);
            } else {
                add(plan.products, productId, name);
            }
        }
    }

    private async scanCollections(
        ctx: RequestContext,
        client: AkeneoApiClient,
        settings: AkeneoConnectionSettings,
        plan: CleanupPlan,
    ) {
        const expected = new Set<string>();
        for (const tree of settings.categoryTreeCodes) {
            if (settings.includeCategoryRoot) expected.add(tree);
            for await (const page of client.pages(await client.categoryTreeDescendants(tree))) {
                for (const category of page.items) expected.add(category.code);
            }
        }

        const collections = await this.connection.getRepository(ctx, Collection).find({
            where: { isRoot: false },
            relations: ['translations'],
        });
        const channelId = String(ctx.channelId);
        const isStale = (c: Collection) =>
            c.customFields.akeneoChannelId === channelId &&
            !!c.customFields.akeneoCode &&
            !expected.has(c.customFields.akeneoCode);
        const children = new Map<string, Collection[]>();
        for (const c of collections) {
            const key = String(c.parentId);
            children.set(key, [...(children.get(key) ?? []), c]);
        }
        // A collection can go when it and everything below it is a stale collection of this sync
        const removable = new Map<string, boolean>();
        const canRemove = (c: Collection): boolean => {
            const key = String(c.id);
            if (!removable.has(key)) {
                removable.set(key, isStale(c) && (children.get(key) ?? []).every(canRemove));
            }
            return removable.get(key) as boolean;
        };
        const byId = new Map(collections.map(c => [String(c.id), c]));
        const subtreeSize = (c: Collection): number =>
            1 + (children.get(String(c.id)) ?? []).reduce((sum, child) => sum + subtreeSize(child), 0);
        for (const c of collections.filter(isStale)) {
            const parent = byId.get(String(c.parentId));
            const parentGoes = !!parent && canRemove(parent);
            if (canRemove(c)) {
                // Removing the top-most collection removes its descendants with it
                if (!parentGoes) {
                    add(plan.collections, c.id, translatedName(c, ctx), subtreeSize(c));
                }
            } else if (!parent || !isStale(parent)) {
                plan.kept.push({
                    kind: 'collection',
                    name: translatedName(c, ctx),
                    reason: 'Contains collections added in Vendure',
                });
            }
        }
    }

    /** Akeneo images of this channel that nothing uses, counting what this cleanup removes as unused. */
    private async scanAssets(ctx: RequestContext, plan: CleanupPlan) {
        const assets = await this.connection.getRepository(ctx, Asset).find({
            where: { customFields: { akeneoCode: Not(IsNull()) }, channels: { id: ctx.channelId } },
            relations: ['translations'],
        });
        if (!assets.length) return;

        const removedProducts = new Set(plan.products.ids);
        const removedVariants = new Set(plan.variants.ids);
        const removedCollections = await this.withDescendants(ctx, plan.collections.ids);
        const used = new Set<string>();

        const products = await this.connection
            .getRepository(ctx, Product)
            .find({ where: { deletedAt: IsNull() }, select: ['id', 'featuredAssetId'] });
        for (const p of products) {
            if (!removedProducts.has(String(p.id)) && p.featuredAssetId) used.add(String(p.featuredAssetId));
        }
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { deletedAt: IsNull() },
            select: ['id', 'productId', 'featuredAssetId'],
        });
        const liveVariant = (v: { id: ID; productId: ID }) =>
            !removedVariants.has(String(v.id)) && !removedProducts.has(String(v.productId));
        const liveVariantIds = new Set(variants.filter(liveVariant).map(v => String(v.id)));
        for (const v of variants) {
            if (liveVariant(v) && v.featuredAssetId) used.add(String(v.featuredAssetId));
        }
        const productAssets = await this.connection
            .getRepository(ctx, ProductAsset)
            .createQueryBuilder('pa')
            .innerJoin('pa.product', 'product', 'product.deletedAt IS NULL')
            .select(['pa.assetId', 'pa.productId'])
            .getMany();
        for (const pa of productAssets) {
            if (!removedProducts.has(String(pa.productId))) used.add(String(pa.assetId));
        }
        const variantAssets = await this.connection
            .getRepository(ctx, ProductVariantAsset)
            .find({ select: ['assetId', 'productVariantId'] });
        for (const va of variantAssets) {
            if (liveVariantIds.has(String(va.productVariantId))) used.add(String(va.assetId));
        }
        const collections = await this.connection
            .getRepository(ctx, Collection)
            .find({ relations: ['featuredAsset'], select: { id: true, featuredAsset: { id: true } } });
        for (const c of collections) {
            if (!removedCollections.has(String(c.id)) && c.featuredAsset)
                used.add(String(c.featuredAsset.id));
        }
        const collectionAssets = await this.connection
            .getRepository(ctx, CollectionAsset)
            .find({ select: ['assetId', 'collectionId'] });
        for (const ca of collectionAssets) {
            if (!removedCollections.has(String(ca.collectionId))) used.add(String(ca.assetId));
        }

        for (const asset of assets) {
            if (!used.has(String(asset.id))) add(plan.assets, asset.id, translatedName(asset, ctx));
        }
    }

    private async remove(ctx: RequestContext, plan: CleanupPlan): Promise<CleanupRemoved> {
        const removed: CleanupRemoved = { products: 0, variants: 0, collections: 0, assets: 0 };

        await this.connection.withTransaction(ctx, async txCtx => {
            const variantIds = plan.variants.ids;
            if (variantIds.length) {
                await this.productVariantService.softDelete(txCtx, variantIds);
                await this.deleteCategoryRows(txCtx, variantIds);
                removed.variants = variantIds.length;
            }
        });
        for (const productId of plan.products.ids) {
            await this.connection.withTransaction(ctx, async txCtx => {
                const variants = await this.connection
                    .getRepository(txCtx, ProductVariant)
                    .find({ where: { productId }, select: ['id'] });
                await this.productService.softDelete(txCtx, productId);
                await this.deleteCategoryRows(
                    txCtx,
                    variants.map(v => v.id),
                );
                removed.products++;
            });
        }
        for (const collectionId of plan.collections.ids) {
            await this.connection.withTransaction(ctx, async txCtx => {
                const descendants = await this.collectionService.getDescendants(txCtx, collectionId);
                await this.collectionService.delete(txCtx, collectionId);
                removed.collections += 1 + descendants.length;
            });
        }
        if (plan.assets.ids.length) {
            await this.connection.withTransaction(ctx, async txCtx => {
                // Usage was checked by the scan, which also counts gallery use (Vendure's check doesn't)
                await this.assetService.delete(txCtx, plan.assets.ids, true, true);
                removed.assets = plan.assets.ids.length;
            });
        }
        Logger.info(`Akeneo cleanup removed ${KINDS.map(k => `${removed[k]} ${k}`).join(', ')}`, loggerCtx);
        return removed;
    }

    private async deleteCategoryRows(ctx: RequestContext, variantIds: ID[]) {
        if (!variantIds.length) return;
        await this.connection.getRepository(ctx, AkeneoVariantCategory).delete({ variantId: In(variantIds) });
    }

    private async withDescendants(ctx: RequestContext, collectionIds: string[]): Promise<Set<string>> {
        const ids = new Set(collectionIds);
        for (const id of collectionIds) {
            for (const d of await this.collectionService.getDescendants(ctx, id)) ids.add(String(d.id));
        }
        return ids;
    }

    /** A completed scan of this channel's cleanup queue. */
    private async findScan(ctx: RequestContext, jobId: ID): Promise<CleanupJobResult | undefined> {
        const strategy = this.configService.jobQueueOptions.jobQueueStrategy;
        if (!isInspectableJobQueueStrategy(strategy)) return undefined;
        const job = await strategy.findOne(jobId);
        const data = job?.data as CleanupJobData | undefined;
        if (
            !job ||
            job.queueName !== CLEANUP_QUEUE ||
            job.state !== JobState.COMPLETED ||
            data?.mode !== 'scan' ||
            data.channelId !== String(ctx.channelId)
        ) {
            return undefined;
        }
        return job.result as CleanupJobResult;
    }

    private async requireSettings(ctx: RequestContext): Promise<AkeneoConnectionSettings> {
        const settings = await this.connectionSettingsService.findForChannel(ctx);
        if (!settings) throw new UserInputError('No Akeneo connection is configured for this channel');
        if (!settings.channelCode) throw new UserInputError('Select an Akeneo channel first');
        return settings;
    }

    private assertIdle(ctx: RequestContext) {
        return assertNoActiveRun(this.configService, ctx, [
            CLEANUP_QUEUE,
            CATEGORY_SYNC_QUEUE,
            PRODUCT_SYNC_QUEUE,
            ASSET_SYNC_QUEUE,
        ]);
    }

    private jobData(ctx: RequestContext, mode: CleanupJobData['mode'], scanJobId: string | null) {
        return {
            ctx: ctx.serialize(),
            channelId: String(ctx.channelId),
            runId: randomUUID(),
            startedAt: new Date().toISOString(),
            mode,
            scanJobId,
        };
    }
}

function emptyKind(): CleanupKind {
    return { ids: [], sizes: [], examples: [] };
}

function add(kind: CleanupKind, id: ID, name: string, size = 1) {
    kind.ids.push(String(id));
    kind.sizes.push(size);
    if (kind.examples.length < MAX_EXAMPLES) kind.examples.push(name);
}

/** Items the kind removes, counting the descendants of removed collections. */
export function kindCount(kind: CleanupKind): number {
    // Scans from before sizes were recorded count one per id
    return (kind.sizes ?? kind.ids.map(() => 1)).reduce((sum, size) => sum + size, 0);
}

/** Only items in both plans; examples are rebuilt from the kept ids' positions. */
function intersect(fresh: CleanupPlan, seen: CleanupPlan): CleanupPlan {
    const pick = (kind: (typeof KINDS)[number]): CleanupKind => {
        const allowed = new Set(seen[kind].ids);
        const keep = fresh[kind].ids.map(id => allowed.has(id));
        return {
            ids: fresh[kind].ids.filter((_, i) => keep[i]),
            sizes: fresh[kind].sizes.filter((_, i) => keep[i]),
            examples: fresh[kind].examples.filter((_, i) => keep[i]),
        };
    };
    return {
        products: pick('products'),
        variants: pick('variants'),
        collections: pick('collections'),
        assets: pick('assets'),
        kept: fresh.kept,
    };
}

function translatedName(
    entity: { id: ID; translations?: Array<{ languageCode: string; name: string }> },
    ctx: RequestContext,
): string {
    const translations = entity.translations ?? [];
    return (
        translations.find(t => t.languageCode === String(ctx.channel.defaultLanguageCode))?.name ??
        translations[0]?.name ??
        String(entity.id)
    );
}
