import { Injectable, OnModuleInit } from '@nestjs/common';
import { CurrencyCode, JobState, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Collection,
    CollectionService,
    ConfigService,
    ID,
    idsAreEqual,
    JobQueue,
    JobQueueService,
    Logger,
    Product,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    SerializedRequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'crypto';
import { In, IsNull } from 'typeorm';

import { AkeneoApiError } from '../akeneo/akeneo-api-client';
import { AkeneoLookups, findMainIdentifierAttribute, pickText, pickValue } from '../akeneo/akeneo-lookups';
import { AkeneoLabels, AkeneoProduct, AkeneoValue, AkeneoValues } from '../akeneo/akeneo-types';
import { CLEANUP_QUEUE, PRODUCT_SYNC_QUEUE, loggerCtx } from '../constants';
import { AkeneoFamilyOverride, AkeneoLocaleMapping } from '../entities/akeneo-connection-settings.entity';
import { AkeneoVariantCategory } from '../entities/akeneo-variant-category.entity';
import {
    ACTIVE_JOB_STATES,
    errorText,
    findChannelJobs,
    assertNoActiveRun,
    MAX_JOB_LOOKBACK,
    runState,
    SyncRunJobData,
    SyncRunState,
} from '../utils/sync-runs';

import { AkeneoApiService } from './akeneo-api.service';
import {
    AkeneoAssetSyncService,
    AkeneoImageRef,
    AkeneoImageTarget,
    ASSET_QUEUE_NAME,
    AssetSyncCounts,
    AssetSyncJobData,
} from './akeneo-asset-sync.service';
import { AkeneoConnectionSettingsService } from './akeneo-connection-settings.service';

// Type aliases (not interfaces) so they satisfy the job queue's JsonCompatible data constraint
type ProductSyncTotals = {
    pages: number;
    /** Akeneo products processed; each becomes one Vendure variant. */
    products: number;
    created: number;
    updated: number;
    unchanged: number;
    productsCreated: number;
};

interface ProductSyncJobData extends SyncRunJobData {
    ctx: SerializedRequestContext;
    totals: ProductSyncTotals;
    /** Settings snapshot taken when the run starts, so a run stays consistent if they change. */
    akeneoChannel: string;
    categoryTree: string;
    localeMapping: AkeneoLocaleMapping[];
    nameAttribute: string | null;
    descriptionAttribute: string | null;
    priceAttribute: string | null;
    syncImages: boolean;
    familyOverrides: AkeneoFamilyOverride[];
    /** Resolved by the first page; null means SKUs fall back to the product UUID. */
    identifierAttribute: string | null;
    /** `next` URL of the previous page; null for the first page. */
    cursor: string | null;
    page: number;
}

export interface ProductSyncPageResult {
    page: number;
    hasNextPage: boolean;
    /** Totals of the run up to and including this page. */
    totals: ProductSyncTotals;
}

export interface ProductSyncStatus extends ProductSyncTotals {
    runId: string;
    images: ImageSyncStatus;
    state: SyncRunState;
    startedAt: Date;
    finishedAt: Date | null;
    error: string | null;
}

export type ImageSyncStatus = AssetSyncCounts & {
    /** Asset jobs still queued or running. */
    pending: number;
    failed: number;
};

type Run = Pick<
    ProductSyncJobData,
    | 'akeneoChannel'
    | 'localeMapping'
    | 'nameAttribute'
    | 'descriptionAttribute'
    | 'priceAttribute'
    | 'syncImages'
    | 'familyOverrides'
    | 'identifierAttribute'
>;
type Names = Map<LanguageCode, string>;
type Counts = Pick<ProductSyncTotals, 'created' | 'updated' | 'unchanged' | 'productsCreated'>;
/** Image targets of a page by `product:<id>` / `variant:<id>`. */
type ImageTargets = Map<string, AkeneoImageTarget>;

/** What an Akeneo product becomes part of: its root model's Product, or its own (simple). */
interface Target {
    key: string;
    field: 'akeneoCode' | 'akeneoUuid';
    value: string;
    family: string | null;
    values: AkeneoValues;
    /** Variant axis attributes of every family variant level, top level first. */
    axes: string[];
    /** Last-resort name: the SKU of a simple product, or the model code. */
    fallbackName: string;
}

interface SyncedProduct {
    id: ID;
    names: Names;
    /** Option group code (axis attribute) -> group id and its options by code. */
    groups: Map<string, { id: ID; options: Map<string, ID> }>;
}

interface AxisOption {
    id: ID;
    names: Names;
}

const QUEUE_NAME = PRODUCT_SYNC_QUEUE;
const JOB_RETRIES = 3;
const EMPTY_TOTALS: ProductSyncTotals = {
    pages: 0,
    products: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    productsCreated: 0,
};

/**
 * Syncs the Akeneo products of the configured Akeneo channel (those classified in its category
 * tree) to Vendure, one Akeneo page per job.
 *
 * - A root product model becomes a Product (matched on `akeneoCode`). Sub models (the second
 *   level of a two-level family variant) create nothing; their values reach the variants through
 *   Akeneo's value inheritance.
 * - A product with a `parent` becomes a ProductVariant of its root model's Product, with one
 *   option group per variant axis of every level.
 * - A product without a `parent` becomes a Product with a single variant (both on `akeneoUuid`).
 *
 * Driving the sync from products means only models with products in the channel become
 * Products. Products moving between simple and variant are handled by retiring the old variant.
 */
@Injectable()
export class AkeneoProductSyncService implements OnModuleInit {
    private queue: JobQueue<ProductSyncJobData>;

    constructor(
        private connection: TransactionalConnection,
        private jobQueueService: JobQueueService,
        private configService: ConfigService,
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private productOptionGroupService: ProductOptionGroupService,
        private productOptionService: ProductOptionService,
        private collectionService: CollectionService,
        private akeneoApiService: AkeneoApiService,
        private connectionSettingsService: AkeneoConnectionSettingsService,
        private assetSyncService: AkeneoAssetSyncService,
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
        const defaultLanguage = ctx.channel.defaultLanguageCode;
        if (!settings.localeMapping.some(m => m.languageCode === defaultLanguage)) {
            throw new UserInputError(`Map an Akeneo locale to the default language "${defaultLanguage}"`);
        }
        await assertNoActiveRun(this.configService, ctx, [QUEUE_NAME, ASSET_QUEUE_NAME, CLEANUP_QUEUE]);

        // Products "belong" to an Akeneo channel when classified in its category tree
        const client = await this.akeneoApiService.getClient(ctx);
        let categoryTree: string | undefined;
        for await (const page of client.pages(await client.channels())) {
            categoryTree ??= page.items.find(c => c.code === settings.channelCode)?.category_tree;
        }
        if (!categoryTree)
            throw new UserInputError(`Akeneo channel "${settings.channelCode}" does not exist`);

        return this.queue.add(
            {
                ctx: ctx.serialize(),
                channelId: String(ctx.channelId),
                runId: randomUUID(),
                startedAt: new Date().toISOString(),
                totals: EMPTY_TOTALS,
                akeneoChannel: settings.channelCode,
                categoryTree,
                localeMapping: settings.localeMapping,
                nameAttribute: settings.productNameAttribute,
                descriptionAttribute: settings.productDescriptionAttribute,
                priceAttribute: settings.productPriceAttribute,
                syncImages: settings.syncImages,
                familyOverrides: settings.familyOverrides,
                identifierAttribute: null,
                cursor: null,
                page: 1,
            },
            { retries: JOB_RETRIES },
        );
    }

    /** Status of this channel's latest run; see `utils/sync-runs.ts` for how runs are tracked. */
    async getStatus(ctx: RequestContext): Promise<ProductSyncStatus | null> {
        const [latest] = await findChannelJobs<ProductSyncJobData>(this.configService, ctx, QUEUE_NAME);
        if (!latest) return null;
        const result = latest.result as ProductSyncPageResult | undefined;
        const images = await this.imageStatus(ctx, latest.data.runId);
        // A run is still going while its images download
        const productState = runState(latest);
        const state = productState === 'COMPLETED' && images.pending ? 'RUNNING' : productState;
        return {
            runId: latest.data.runId,
            state,
            ...(result?.totals ?? latest.data.totals),
            images,
            startedAt: new Date(latest.data.startedAt),
            finishedAt: state === 'RUNNING' ? null : (latest.settledAt ?? null),
            error: state === 'FAILED' ? errorText(latest.error) : null,
        };
    }

    /** Image counts summed over the run's asset jobs. */
    private async imageStatus(ctx: RequestContext, runId: string): Promise<ImageSyncStatus> {
        const jobs = await findChannelJobs<AssetSyncJobData>(
            this.configService,
            ctx,
            ASSET_QUEUE_NAME,
            {},
            MAX_JOB_LOOKBACK,
        );
        const status: ImageSyncStatus = {
            downloaded: 0,
            reused: 0,
            assigned: 0,
            skipped: 0,
            pending: 0,
            failed: 0,
        };
        for (const job of jobs.filter(j => j.data.runId === runId)) {
            if (ACTIVE_JOB_STATES.includes(job.state)) status.pending++;
            else if (job.state === JobState.FAILED) status.failed++;
            const counts = job.result as AssetSyncCounts | undefined;
            if (!counts) continue;
            status.downloaded += counts.downloaded;
            status.reused += counts.reused;
            status.assigned += counts.assigned;
            status.skipped += counts.skipped;
        }
        return status;
    }

    private async syncPage(data: ProductSyncJobData): Promise<ProductSyncPageResult> {
        const ctx = RequestContext.deserialize(data.ctx);
        const settings = await this.connectionSettingsService.findForChannel(ctx);
        if (!settings?.enabled) throw new UserInputError('Akeneo sync is disabled for this channel');

        const client = await this.akeneoApiService.getClient(ctx);
        const identifierAttribute = data.cursor
            ? data.identifierAttribute
            : await findMainIdentifierAttribute(client);
        const page = data.cursor
            ? await client.getPage<AkeneoProduct>(data.cursor)
            : await client.products({
                  search: { categories: [{ operator: 'IN CHILDREN', value: [data.categoryTree] }] },
                  scope: data.akeneoChannel,
                  locales: [...new Set(data.localeMapping.map(m => m.locale))],
              });

        // Older queued jobs may predate the image and family settings
        const run: Run = {
            ...data,
            identifierAttribute,
            syncImages: data.syncImages ?? false,
            familyOverrides: data.familyOverrides ?? [],
        };
        const lookups = new AkeneoLookups(client);
        const imageTargets: ImageTargets = new Map();
        const counts = await this.connection.withTransaction(ctx, txCtx =>
            this.upsertProducts(txCtx, page.items, lookups, run, imageTargets),
        );
        // Queued after the page's transaction, so the job sees its products and variants
        const locale = this.defaultLocale(ctx, run);
        if (imageTargets.size && locale) {
            await this.assetSyncService.add({
                ctx: data.ctx,
                channelId: data.channelId,
                runId: data.runId,
                startedAt: data.startedAt,
                akeneoChannel: data.akeneoChannel,
                locale,
                targets: [...imageTargets.values()],
            });
        }

        const totals: ProductSyncTotals = {
            pages: data.totals.pages + 1,
            products: data.totals.products + page.items.length,
            created: data.totals.created + counts.created,
            updated: data.totals.updated + counts.updated,
            unchanged: data.totals.unchanged + counts.unchanged,
            productsCreated: data.totals.productsCreated + counts.productsCreated,
        };
        if (page.next) {
            await this.queue.add(
                { ...data, totals, identifierAttribute, cursor: page.next, page: data.page + 1 },
                { retries: JOB_RETRIES },
            );
        } else {
            Logger.info(`Akeneo product sync finished after ${data.page} page(s)`, loggerCtx);
        }
        return { page: data.page, hasNextPage: !!page.next, totals };
    }

    private async upsertProducts(
        ctx: RequestContext,
        items: AkeneoProduct[],
        lookups: AkeneoLookups,
        run: Run,
        imageTargets: ImageTargets,
    ): Promise<Counts> {
        const counts: Counts = { created: 0, updated: 0, unchanged: 0, productsCreated: 0 };
        const variants = await this.findVariants(
            ctx,
            items.map(i => i.uuid),
        );
        const products = new Map<string, SyncedProduct>();
        const touched = new Set<ID>();
        const changedCategories = new Set<string>();

        for (const item of items) {
            const target = await this.resolveTarget(item, lookups, run);
            let product = products.get(target.key);
            if (!product) {
                product = await this.upsertProduct(ctx, target, lookups, run, counts);
                products.set(target.key, product);
            }
            const options: AxisOption[] = [];
            for (const axis of target.axes) {
                options.push(await this.upsertAxisOption(ctx, product, axis, item, lookups, run));
            }
            const { outcome, id } = await this.upsertVariant(
                ctx,
                item,
                product,
                options,
                variants.get(item.uuid),
                run,
            );
            const categories = await this.withAncestors(item.categories, lookups);
            const categoriesChanged = await this.syncVariantCategories(
                ctx,
                id,
                categories,
                changedCategories,
            );
            counts[outcome === 'unchanged' && categoriesChanged ? 'updated' : outcome]++;
            touched.add(product.id);
            if (run.syncImages) {
                await this.collectImages(ctx, item, target, product.id, id, lookups, run, imageTargets);
            }
        }
        await this.syncProductEnabled(ctx, touched);
        await this.reapplyCategoryCollections(ctx, changedCategories);
        return counts;
    }

    private async resolveTarget(item: AkeneoProduct, lookups: AkeneoLookups, run: Run): Promise<Target> {
        if (!item.parent) {
            return {
                key: `simple:${item.uuid}`,
                field: 'akeneoUuid',
                value: item.uuid,
                family: item.family,
                values: item.values,
                axes: [],
                fallbackName: this.sku(item, run),
            };
        }
        const root = await lookups.rootModel(item.parent);
        const familyVariant = await lookups.familyVariant(root.family, root.family_variant);
        const axes = [...familyVariant.variant_attribute_sets]
            .sort((a, b) => a.level - b.level)
            .flatMap(set => set.axes);
        return {
            key: `model:${root.code}`,
            field: 'akeneoCode',
            value: root.code,
            family: root.family,
            values: root.values,
            axes,
            fallbackName: root.code,
        };
    }

    private async upsertProduct(
        ctx: RequestContext,
        target: Target,
        lookups: AkeneoLookups,
        run: Run,
        counts: Counts,
    ): Promise<SyncedProduct> {
        const names = await this.productNames(ctx, target, lookups, run);
        const descriptions = this.descriptions(ctx, target, run);
        let existing = await this.connection.getRepository(ctx, Product).findOne({
            where: { customFields: { [target.field]: target.value } },
            relations: ['translations', 'optionGroups', 'optionGroups.options'],
        });
        if (existing?.deletedAt) {
            // Deleted in Vendure: release the Akeneo id so a new Product can take it
            await this.connection
                .getRepository(ctx, Product)
                .update(existing.id, { customFields: { [target.field]: null } });
            existing = null;
        }

        if (!existing) {
            const created = await this.productService.create(ctx, {
                enabled: true,
                translations: [...names].map(([languageCode, name]) => ({
                    languageCode,
                    name,
                    slug: name,
                    description: descriptions?.get(languageCode) ?? '',
                })),
                customFields: { [target.field]: target.value },
            });
            counts.productsCreated++;
            return { id: created.id, names, groups: new Map() };
        }

        const current = new Map(existing.translations.map(t => [t.languageCode, t]));
        const changed = [...names].filter(([lang, name]) => {
            const translation = current.get(lang);
            const description = descriptions?.get(lang);
            return (
                translation?.name !== name || (description != null && translation.description !== description)
            );
        });
        if (changed.length) {
            await this.productService.update(ctx, {
                id: existing.id,
                // New languages need a slug; existing ones keep theirs so URLs stay stable
                translations: changed.map(([languageCode, name]) => {
                    const description = descriptions?.get(languageCode);
                    return current.has(languageCode)
                        ? { languageCode, name, ...(description != null ? { description } : {}) }
                        : { languageCode, name, slug: name, description: description ?? '' };
                }),
            });
        }
        const groups = new Map(
            existing.optionGroups
                .filter(g => !g.deletedAt)
                .map(g => [
                    g.code,
                    {
                        id: g.id,
                        options: new Map(g.options.filter(o => !o.deletedAt).map(o => [o.code, o.id])),
                    },
                ]),
        );
        return { id: existing.id, names, groups };
    }

    /** Finds or creates the option for this product's value of a variant axis. */
    private async upsertAxisOption(
        ctx: RequestContext,
        product: SyncedProduct,
        axis: string,
        item: AkeneoProduct,
        lookups: AkeneoLookups,
        run: Run,
    ): Promise<AxisOption> {
        const value = pickValue(item.values, axis, run.localeMapping[0]?.locale ?? null, run.akeneoChannel);
        if (value?.data == null) {
            throw new AkeneoApiError(
                `Akeneo product ${item.uuid} has no value for variant axis "${axis}"`,
                null,
            );
        }
        const { code, labels } = await this.axisValue(axis, value, lookups);
        const names = this.namesFromLabels(ctx, labels, run, code);

        let group = product.groups.get(axis);
        if (!group) {
            const attribute = await lookups.attribute(axis);
            const created = await this.productOptionGroupService.create(ctx, {
                code: axis,
                translations: this.translations(this.namesFromLabels(ctx, attribute.labels, run, axis)),
            });
            await this.productService.addOptionGroupToProduct(ctx, product.id, created.id);
            group = { id: created.id, options: new Map() };
            product.groups.set(axis, group);
        }
        let optionId = group.options.get(code);
        if (!optionId) {
            const option = await this.productOptionService.create(ctx, group.id, {
                code,
                translations: this.translations(names),
            });
            optionId = option.id;
            group.options.set(code, optionId);
        }
        return { id: optionId, names };
    }

    /** Option code and labels for the axis value types Akeneo allows. */
    private async axisValue(
        axis: string,
        value: AkeneoValue,
        lookups: AkeneoLookups,
    ): Promise<{ code: string; labels: AkeneoLabels }> {
        const data = value.data;
        switch (value.attribute_type) {
            case 'pim_catalog_simpleselect': {
                const code = String(data);
                return { code, labels: (await lookups.option(axis, code))?.labels ?? {} };
            }
            case 'pim_catalog_boolean':
                return { code: data ? 'yes' : 'no', labels: { '*': data ? 'Yes' : 'No' } };
            case 'pim_catalog_metric': {
                const metric = data as { amount: string | number; unit: string };
                const amount = String(Number(metric.amount));
                return { code: `${amount}_${metric.unit}`, labels: { '*': `${amount} ${metric.unit}` } };
            }
            default:
                // Reference entity records and anything else: the code is the best label we have
                return { code: String(data), labels: {} };
        }
    }

    private async upsertVariant(
        ctx: RequestContext,
        item: AkeneoProduct,
        product: SyncedProduct,
        options: AxisOption[],
        existing: ProductVariant | undefined,
        run: Run,
    ): Promise<{ outcome: 'created' | 'updated' | 'unchanged'; id: ID }> {
        const sku = this.sku(item, run);
        const names = this.variantNames(product.names, options);
        const optionIds = options.map(o => o.id);
        const prices = this.prices(ctx, item, run);

        if (existing?.deletedAt) {
            await this.releaseVariant(ctx, existing.id);
            existing = undefined;
        }
        if (existing && !idsAreEqual(existing.productId, product.id)) {
            // Moved between simple and variant (or to another model): retire the old variant
            await this.retireVariant(ctx, existing, item.uuid);
            existing = undefined;
        }

        if (!existing) {
            const [created] = await this.productVariantService.create(ctx, [
                {
                    productId: product.id,
                    sku,
                    optionIds,
                    enabled: item.enabled,
                    translations: this.translations(names),
                    ...(prices?.length ? { prices } : {}),
                    customFields: { akeneoUuid: item.uuid },
                },
            ]);
            return { outcome: 'created', id: created.id };
        }

        const currentNames = new Map(existing.translations.map(t => [t.languageCode, t.name]));
        const changedNames = [...names].filter(([lang, name]) => currentNames.get(lang) !== name);
        const optionsChanged =
            [...optionIds].map(String).sort().join() !==
            existing.options
                .map(o => String(o.id))
                .sort()
                .join();
        const currentPrices = new Map(
            existing.productVariantPrices
                .filter(p => idsAreEqual(p.channelId, ctx.channelId))
                .map(p => [p.currencyCode as string, p.price]),
        );
        const pricesChanged = !!prices?.some(p => currentPrices.get(p.currencyCode) !== p.price);
        if (
            !pricesChanged &&
            existing.sku === sku &&
            existing.enabled === item.enabled &&
            !changedNames.length &&
            !optionsChanged
        ) {
            return { outcome: 'unchanged', id: existing.id };
        }
        await this.productVariantService.update(ctx, [
            {
                id: existing.id,
                sku,
                enabled: item.enabled,
                ...(optionsChanged ? { optionIds } : {}),
                ...(pricesChanged ? { prices } : {}),
                ...(changedNames.length ? { translations: this.translations(new Map(changedNames)) } : {}),
            },
        ]);
        return { outcome: 'updated', id: existing.id };
    }

    private async retireVariant(ctx: RequestContext, variant: ProductVariant, akeneoUuid: string) {
        await this.releaseVariant(ctx, variant.id);
        await this.connection.getRepository(ctx, AkeneoVariantCategory).delete({ variantId: variant.id });
        await this.productVariantService.softDelete(ctx, variant.id);
        // A simple product's Product only existed for this variant
        if (variant.product.customFields.akeneoUuid === akeneoUuid) {
            await this.connection
                .getRepository(ctx, Product)
                .update(variant.productId, { customFields: { akeneoUuid: null } });
            await this.productService.softDelete(ctx, variant.productId);
        }
    }

    /** Clears the Akeneo id of a variant so another variant can take it (it is unique). */
    private releaseVariant(ctx: RequestContext, id: ID) {
        return this.connection
            .getRepository(ctx, ProductVariant)
            .update(id, { customFields: { akeneoUuid: null } });
    }

    /** The categories plus all their ancestors, so parent Collections include descendants. */
    /**
     * Which images the product and variant should have. The product gets its own images (the
     * root model's, or a simple product's); a variant gets its own only where they differ from
     * the product's, e.g. images set on a colour sub model. A product without images of its own
     * borrows a variant's.
     */
    private async collectImages(
        ctx: RequestContext,
        item: AkeneoProduct,
        target: Target,
        productId: ID,
        variantId: ID,
        lookups: AkeneoLookups,
        run: Run,
        imageTargets: ImageTargets,
    ) {
        const productRefs = await this.imageRefs(ctx, target.values, target.family, lookups, run);
        const variantRefs =
            target.field === 'akeneoUuid'
                ? productRefs
                : await this.imageRefs(ctx, item.values, item.family, lookups, run);
        const ownRefs = sameRefs(variantRefs, productRefs) ? [] : variantRefs;
        imageTargets.set(`variant:${variantId}`, { type: 'variant', id: String(variantId), refs: ownRefs });

        const productKey = `product:${productId}`;
        const existing = imageTargets.get(productKey);
        if (productRefs.length) {
            imageTargets.set(productKey, { type: 'product', id: String(productId), refs: productRefs });
        } else if (!existing || (existing.fallback && !existing.refs.length)) {
            imageTargets.set(productKey, {
                type: 'product',
                id: String(productId),
                refs: variantRefs,
                fallback: true,
            });
        }
    }

    /** The images of the family's image attributes, in order. */
    private async imageRefs(
        ctx: RequestContext,
        values: AkeneoValues,
        family: string | null,
        lookups: AkeneoLookups,
        run: Run,
    ): Promise<AkeneoImageRef[]> {
        if (!family) return [];
        const override = this.mapping(run, family).imageAttributes;
        const attributes = override.length ? override : await lookups.familyImageAttributes(family);
        const locale = this.defaultLocale(ctx, run);
        const refs: AkeneoImageRef[] = [];
        for (const code of attributes) {
            const data = pickValue(values, code, locale, run.akeneoChannel)?.data;
            if (typeof data === 'string' && data) {
                refs.push({ kind: 'media', code: data });
            } else if (Array.isArray(data) && data.length) {
                const assetFamily = (await lookups.attribute(code)).reference_data_name;
                if (!assetFamily) continue;
                for (const assetCode of data) {
                    if (typeof assetCode === 'string')
                        refs.push({ kind: 'asset', assetFamily, code: assetCode });
                }
            }
        }
        return refs;
    }

    /** The attributes for a family: its override where set, else the defaults. */
    private mapping(run: Run, family: string | null) {
        const override = family ? run.familyOverrides.find(o => o.family === family) : undefined;
        return {
            nameAttribute: override?.nameAttribute ?? run.nameAttribute,
            descriptionAttribute: override?.descriptionAttribute ?? run.descriptionAttribute,
            priceAttribute: override?.priceAttribute ?? run.priceAttribute,
            imageAttributes: override?.imageAttributes ?? [],
        };
    }

    private defaultLocale(ctx: RequestContext, run: Pick<Run, 'localeMapping'>): string | null {
        const defaultLanguage = ctx.channel.defaultLanguageCode;
        return run.localeMapping.find(m => m.languageCode === defaultLanguage)?.locale ?? null;
    }

    private async withAncestors(codes: string[], lookups: AkeneoLookups): Promise<string[]> {
        const all = new Set<string>();
        for (const code of codes) {
            let current: string | null = code;
            while (current && !all.has(current)) {
                all.add(current);
                current = (await lookups.category(current))?.parent ?? null;
            }
        }
        return [...all];
    }

    /** Replaces the variant's category rows; returns whether they changed. */
    private async syncVariantCategories(
        ctx: RequestContext,
        variantId: ID,
        codes: string[],
        changed: Set<string>,
    ): Promise<boolean> {
        const repo = this.connection.getRepository(ctx, AkeneoVariantCategory);
        const current = new Set((await repo.find({ where: { variantId } })).map(r => r.categoryCode));
        const wanted = new Set(codes);
        const added = codes.filter(code => !current.has(code));
        const removed = [...current].filter(code => !wanted.has(code));
        if (removed.length) await repo.delete({ variantId, categoryCode: In(removed) });
        if (added.length) {
            await repo.save(
                added.map(categoryCode => new AkeneoVariantCategory({ variantId, categoryCode })),
            );
        }
        [...added, ...removed].forEach(code => changed.add(code));
        return added.length > 0 || removed.length > 0;
    }

    /** Re-applies the filters of this channel's Collections for categories whose variants changed. */
    private async reapplyCategoryCollections(ctx: RequestContext, codes: Set<string>) {
        if (!codes.size) return;
        const collections = await this.connection.getRepository(ctx, Collection).find({
            where: { customFields: { akeneoCode: In([...codes]), akeneoChannelId: String(ctx.channelId) } },
            select: ['id'],
        });
        if (collections.length) {
            await this.collectionService.triggerApplyFiltersJob(ctx, {
                collectionIds: collections.map(c => c.id),
                applyToChangedVariantsOnly: false,
            });
        }
    }

    /** A Product is enabled when any of its variants is. */
    private async syncProductEnabled(ctx: RequestContext, productIds: Set<ID>) {
        for (const id of productIds) {
            const anyEnabled = await this.connection.getRepository(ctx, ProductVariant).exists({
                where: { productId: id, enabled: true, deletedAt: IsNull() },
            });
            const product = await this.connection
                .getRepository(ctx, Product)
                .findOne({ where: { id }, select: ['id', 'enabled'] });
            if (product && product.enabled !== anyEnabled) {
                await this.productService.update(ctx, { id, enabled: anyEnabled });
            }
        }
    }

    /**
     * Name per mapped language from the name attribute (or the family's label attribute). The
     * default language always gets a name: the attribute in any locale, then the family label
     * attribute, then the SKU or model code.
     */
    private async productNames(ctx: RequestContext, target: Target, lookups: AkeneoLookups, run: Run) {
        const familyLabel = target.family ? (await lookups.family(target.family)).attribute_as_label : null;
        const { nameAttribute } = this.mapping(run, target.family);
        const attributes = [...new Set([nameAttribute, familyLabel])].filter((a): a is string => !!a);
        const names: Names = new Map();
        const available = new Set(ctx.channel.availableLanguageCodes ?? []);
        for (const { languageCode, locale } of run.localeMapping) {
            const name = attributes
                .map(attribute => pickText(target.values, attribute, locale, run.akeneoChannel))
                .find(Boolean);
            if (name && available.has(languageCode)) names.set(languageCode, name);
        }
        const defaultLanguage = ctx.channel.defaultLanguageCode;
        if (!names.has(defaultLanguage)) {
            const anyLocale = attributes
                .flatMap(attribute => target.values[attribute] ?? [])
                .find(
                    v =>
                        typeof v.data === 'string' &&
                        v.data.trim() &&
                        (!v.scope || v.scope === run.akeneoChannel),
                );
            names.set(
                defaultLanguage,
                (anyLocale?.data as string | undefined)?.trim() ?? target.fallbackName,
            );
        }
        return names;
    }

    /** Description per name language; undefined when descriptions are left to Vendure. */
    private descriptions(ctx: RequestContext, target: Target, run: Run): Names | undefined {
        const { descriptionAttribute } = this.mapping(run, target.family);
        if (!descriptionAttribute) return undefined;
        const descriptions: Names = new Map();
        for (const { languageCode, locale } of run.localeMapping) {
            descriptions.set(
                languageCode,
                pickText(target.values, descriptionAttribute, locale, run.akeneoChannel) ?? '',
            );
        }
        return descriptions;
    }

    /**
     * Prices for the channel's currencies that Akeneo has an amount for; undefined when prices are
     * left to Vendure. Amounts are converted to Vendure's integer minor units.
     */
    private prices(ctx: RequestContext, item: AkeneoProduct, run: Run) {
        const { priceAttribute } = this.mapping(run, item.family);
        if (!priceAttribute) return undefined;
        const data = pickValue(item.values, priceAttribute, null, run.akeneoChannel)?.data;
        if (!Array.isArray(data)) return [];
        const currencies = new Set<string>(
            ctx.channel.availableCurrencyCodes ?? [ctx.channel.defaultCurrencyCode],
        );
        const factor = 10 ** (this.configService.entityOptions.moneyStrategy?.precision ?? 2);
        return (data as Array<{ amount: string | number | null; currency: string }>)
            .filter(p => p.amount != null && p.amount !== '' && currencies.has(p.currency))
            .map(p => ({
                currencyCode: p.currency as CurrencyCode,
                price: Math.round(Number(p.amount) * factor),
            }));
    }

    private sku(item: AkeneoProduct, run: Run): string {
        return (
            (run.identifierAttribute &&
                pickText(item.values, run.identifierAttribute, null, run.akeneoChannel)) ||
            item.uuid
        );
    }

    /** Variants are named after their product and option values, e.g. "Polo Shirt White S". */
    private variantNames(productNames: Names, options: AxisOption[]): Names {
        const names: Names = new Map();
        for (const [lang, name] of productNames) {
            const optionNames = options.map(o => o.names.get(lang)).filter(Boolean);
            names.set(lang, [name, ...optionNames].join(' '));
        }
        return names;
    }

    /** Labels by Akeneo locale (or `*` for any locale) -> names by Vendure language. */
    private namesFromLabels(ctx: RequestContext, labels: AkeneoLabels, run: Run, fallback: string): Names {
        const available = new Set(ctx.channel.availableLanguageCodes ?? []);
        const names: Names = new Map();
        for (const { languageCode, locale } of run.localeMapping) {
            const label = (labels[locale] ?? labels['*'])?.trim();
            if (label && available.has(languageCode)) names.set(languageCode, label);
        }
        const defaultLanguage = ctx.channel.defaultLanguageCode;
        if (!names.has(defaultLanguage)) names.set(defaultLanguage, fallback);
        return names;
    }

    private translations(names: Names) {
        return [...names].map(([languageCode, name]) => ({ languageCode, name }));
    }

    private async findVariants(ctx: RequestContext, uuids: string[]) {
        if (!uuids.length) return new Map<string, ProductVariant>();
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { customFields: { akeneoUuid: In(uuids) } },
            relations: ['translations', 'options', 'product', 'productVariantPrices'],
        });
        return new Map(variants.map(v => [v.customFields.akeneoUuid as string, v]));
    }
}

function sameRefs(a: AkeneoImageRef[], b: AkeneoImageRef[]): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
