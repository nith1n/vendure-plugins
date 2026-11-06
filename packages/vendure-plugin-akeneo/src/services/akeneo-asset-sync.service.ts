import { Injectable, OnModuleInit } from '@nestjs/common';
import {
    Asset,
    AssetService,
    ChannelService,
    ID,
    idsAreEqual,
    isGraphQlErrorResult,
    JobQueue,
    JobQueueService,
    Logger,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    SerializedRequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';

import { AkeneoApiClient } from '../akeneo/akeneo-api-client';
import { AkeneoLookups } from '../akeneo/akeneo-lookups';
import { AkeneoAsset, AkeneoAssetValue } from '../akeneo/akeneo-types';
import { ASSET_SYNC_QUEUE, loggerCtx } from '../constants';
import { AkeneoImageRun } from '../entities/akeneo-image-run.entity';
import { SyncRunJobData } from '../utils/sync-runs';

import { AkeneoApiService } from './akeneo-api.service';

// Type aliases (not interfaces) so they satisfy the job queue's JsonCompatible data constraint
/** An image as referenced by a product value: a media file code, or an Asset Manager asset. */
export type AkeneoImageRef =
    { kind: 'media'; code: string } | { kind: 'asset'; assetFamily: string; code: string };

export type AkeneoImageTarget = {
    type: 'product' | 'variant';
    id: string;
    refs: AkeneoImageRef[];
    /**
     * Images borrowed from a variant because the product has none of its own. Only applied
     * while the product has no Akeneo images, so pages with different variants don't fight.
     */
    fallback?: boolean;
};

export type AssetSyncCounts = {
    downloaded: number;
    reused: number;
    assigned: number;
    skipped: number;
};

export interface AssetSyncJobData extends SyncRunJobData {
    ctx: SerializedRequestContext;
    akeneoChannel: string;
    /** Akeneo locale of the channel's default language, for localizable images and labels. */
    locale: string;
    targets: AkeneoImageTarget[];
}

/** An image resolved to the Akeneo file it is stored in. */
interface ResolvedImage {
    fileCode: string;
    source: 'media' | 'asset';
    /** Asset label; null names the Vendure Asset after the file. */
    label: string | null;
}

type AssetHolder = Product | ProductVariant;
type RunColumn = 'queued' | 'completed' | 'failed' | keyof AssetSyncCounts;

export const ASSET_QUEUE_NAME = ASSET_SYNC_QUEUE;
const JOB_RETRIES = 3;
const MEDIA_FILE_TYPE = 'media_file';

/**
 * Downloads the images of synced products into Vendure Assets and assigns them, one job per
 * product sync page. Vendure Assets are keyed by Akeneo file code (`Asset.akeneoCode`): file
 * codes are content hashes, so a file used in several places is downloaded once, and a changed
 * image arrives as a new file code.
 *
 * Akeneo images are kept first, in attribute order; Assets added in Vendure are kept after them.
 */
@Injectable()
export class AkeneoAssetSyncService implements OnModuleInit {
    private queue: JobQueue<AssetSyncJobData>;

    constructor(
        private connection: TransactionalConnection,
        private jobQueueService: JobQueueService,
        private assetService: AssetService,
        private channelService: ChannelService,
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private akeneoApiService: AkeneoApiService,
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: ASSET_QUEUE_NAME,
            process: async job => {
                const ctx = RequestContext.deserialize(job.data.ctx);
                try {
                    const counts = await this.syncAssets(job.data);
                    await this.addToRun(ctx, job.data.runId, { completed: 1, ...counts });
                    return counts;
                } catch (e) {
                    // Attempts are counted before a job runs, so this was the last one
                    if (job.attempts > job.retries) await this.addToRun(ctx, job.data.runId, { failed: 1 });
                    throw e;
                }
            },
        });
    }

    async add(ctx: RequestContext, data: AssetSyncJobData) {
        await this.connection
            .getRepository(ctx, AkeneoImageRun)
            .createQueryBuilder()
            .insert()
            .values({ runId: data.runId })
            .orIgnore()
            .execute();
        await this.addToRun(ctx, data.runId, { queued: 1 });
        return this.queue.add(data, { retries: JOB_RETRIES });
    }

    /** Image totals of a product sync run; null for runs without image jobs. */
    findRun(ctx: RequestContext, runId: string): Promise<AkeneoImageRun | null> {
        return this.connection.getRepository(ctx, AkeneoImageRun).findOne({ where: { runId } });
    }

    private async addToRun(ctx: RequestContext, runId: string, amounts: Partial<Record<RunColumn, number>>) {
        const repository = this.connection.getRepository(ctx, AkeneoImageRun);
        // Atomic increments: a run's asset jobs can finish at the same time
        for (const [column, amount] of Object.entries(amounts)) {
            if (amount) await repository.increment({ runId }, column, amount);
        }
    }

    private async syncAssets(data: AssetSyncJobData): Promise<AssetSyncCounts> {
        const ctx = RequestContext.deserialize(data.ctx);
        const client = await this.akeneoApiService.getClient(ctx);
        const lookups = new AkeneoLookups(client);
        const counts: AssetSyncCounts = { downloaded: 0, reused: 0, assigned: 0, skipped: 0 };

        const resolved = new Map<string, ResolvedImage | null>();
        for (const ref of data.targets.flatMap(t => t.refs)) {
            const key = refKey(ref);
            if (!resolved.has(key)) resolved.set(key, await this.resolve(ref, lookups, data));
        }
        const images = [...resolved.values()].filter((i): i is ResolvedImage => !!i);
        counts.skipped += resolved.size - images.length;

        const assets = await this.ensureAssets(ctx, client, images, counts);
        for (const target of data.targets) {
            const assetIds = target.refs
                .map(ref => resolved.get(refKey(ref)))
                .map(image => image && assets.get(image.fileCode))
                .filter((id): id is ID => id != null);
            const changed = await this.connection.withTransaction(ctx, txCtx =>
                this.assign(txCtx, target, unique(assetIds)),
            );
            if (changed) counts.assigned++;
        }
        return counts;
    }

    /** The Akeneo file behind an image, or null when it can't be synced. */
    private async resolve(
        ref: AkeneoImageRef,
        lookups: AkeneoLookups,
        data: AssetSyncJobData,
    ): Promise<ResolvedImage | null> {
        if (ref.kind === 'media') return { fileCode: ref.code, source: 'media', label: null };

        const asset = await lookups.asset(ref.assetFamily, ref.code);
        if (!asset) return null;
        const family = await lookups.assetFamily(ref.assetFamily);
        const mainMedia = await lookups.assetFamilyAttribute(ref.assetFamily, family.attribute_as_main_media);
        if (mainMedia.type !== MEDIA_FILE_TYPE) {
            // Media links point outside Akeneo; fetching URLs from PIM data isn't supported
            Logger.verbose(
                `Skipping asset "${ref.code}": main media of "${ref.assetFamily}" is a ${mainMedia.type}`,
                loggerCtx,
            );
            return null;
        }
        const fileCode = assetText(asset, mainMedia.code, data);
        if (!fileCode) return null;
        return { fileCode, source: 'asset', label: assetText(asset, 'label', data) };
    }

    /** Vendure Asset id by file code, downloading the files Vendure doesn't have yet. */
    private async ensureAssets(
        ctx: RequestContext,
        client: AkeneoApiClient,
        images: ResolvedImage[],
        counts: AssetSyncCounts,
    ): Promise<Map<string, ID>> {
        const byFileCode = new Map(images.map(i => [i.fileCode, i]));
        const existing = byFileCode.size
            ? await this.connection.getRepository(ctx, Asset).find({
                  where: { customFields: { akeneoCode: In([...byFileCode.keys()]) } },
                  relations: ['channels'],
              })
            : [];
        const ids = new Map<string, ID>();
        for (const asset of existing) {
            const fileCode = asset.customFields.akeneoCode as string;
            if (!asset.channels.some(c => idsAreEqual(c.id, ctx.channelId))) {
                // Downloaded by another channel's sync; share it rather than downloading again
                await this.channelService.assignToChannels(ctx, Asset, asset.id, [ctx.channelId]);
            }
            ids.set(fileCode, asset.id);
            counts.reused++;
        }

        for (const image of byFileCode.values()) {
            if (ids.has(image.fileCode)) continue;
            // One transaction per file, so a bad file doesn't undo the others
            const id = await this.connection.withTransaction(ctx, txCtx =>
                this.download(txCtx, client, image),
            );
            if (id == null) {
                counts.skipped++;
            } else {
                ids.set(image.fileCode, id);
                counts.downloaded++;
            }
        }
        return ids;
    }

    private async download(ctx: RequestContext, client: AkeneoApiClient, image: ResolvedImage) {
        const file =
            image.source === 'media'
                ? await client.downloadMediaFile(image.fileCode)
                : await client.downloadAssetMediaFile(image.fileCode);
        const filename = file.filename ?? fileName(image.fileCode);
        const result = await this.assetService.create(ctx, {
            file: {
                createReadStream: () => file.stream,
                filename,
                mimetype: file.contentType?.split(';')[0].trim() ?? 'application/octet-stream',
                encoding: '7bit',
            },
            ...(image.label
                ? { translations: [{ languageCode: ctx.channel.defaultLanguageCode, name: image.label }] }
                : {}),
            customFields: { akeneoCode: image.fileCode },
        });
        if (isGraphQlErrorResult(result)) {
            file.stream.destroy();
            Logger.warn(`Skipping Akeneo file "${image.fileCode}": ${result.message}`, loggerCtx);
            return null;
        }
        return result.id;
    }

    /**
     * Sets the Akeneo images when they changed: Akeneo images first, then the Assets added in
     * Vendure. While they are unchanged, the order and featured Asset picked in Vendure are kept.
     * True when anything changed.
     */
    private async assign(ctx: RequestContext, target: AkeneoImageTarget, akeneoIds: ID[]) {
        const entity = await this.connection
            .getRepository(ctx, target.type === 'product' ? Product : ProductVariant)
            .findOne({
                where: { id: target.id },
                relations: ['assets', 'assets.asset', 'featuredAsset'],
            });
        if (!entity || entity.deletedAt) return false;

        const current = [...entity.assets].sort((a, b) => a.position - b.position);
        const fromAkeneo = (asset: Asset | undefined | null) => !!asset?.customFields.akeneoCode;
        const currentAkeneo = current.filter(a => fromAkeneo(a.asset)).map(a => a.assetId);
        if (target.fallback && currentAkeneo.length) return false;

        const featured = entity.featuredAsset;
        if (sameIds(currentAkeneo, akeneoIds) && (featured || !current.length)) return false;

        const manual = current.filter(a => !fromAkeneo(a.asset)).map(a => a.assetId);
        const assetIds = [...akeneoIds, ...manual];
        // A featured Asset added in Vendure stays; otherwise the first Akeneo image is featured
        const keepFeatured =
            featured && !fromAkeneo(featured) && manual.some(id => idsAreEqual(id, featured.id));
        const featuredAssetId = keepFeatured ? featured.id : (assetIds[0] ?? null);

        await this.update(ctx, target.type, entity, assetIds, featuredAssetId);
        return true;
    }

    private async update(
        ctx: RequestContext,
        type: AkeneoImageTarget['type'],
        entity: AssetHolder,
        assetIds: ID[],
        featuredAssetId: ID | null,
    ) {
        // Null only happens with no Assets left, and an empty list clears the featured Asset
        const input = { id: entity.id, assetIds, featuredAssetId: featuredAssetId ?? undefined };
        if (type === 'product') {
            await this.productService.update(ctx, input);
        } else {
            await this.productVariantService.update(ctx, [input]);
        }
    }
}

function refKey(ref: AkeneoImageRef): string {
    return ref.kind === 'media' ? `media:${ref.code}` : `asset:${ref.assetFamily}:${ref.code}`;
}

/**
 * A text value of an asset for the Akeneo channel and locale. Values not scoped to a channel
 * or locale match any.
 */
function assetText(asset: AkeneoAsset, attribute: string, data: AssetSyncJobData): string | null {
    const candidates = (asset.values[attribute] ?? []).filter(
        (v: AkeneoAssetValue) => v.channel === null || v.channel === data.akeneoChannel,
    );
    const value = candidates.find(v => v.locale === data.locale) ?? candidates.find(v => v.locale === null);
    return typeof value?.data === 'string' && value.data.trim() ? value.data.trim() : null;
}

/** File codes look like `4/e/1/a/<sha1>_name.jpg`; the part after the hash is the file name. */
function fileName(fileCode: string): string {
    const base = fileCode.split('/').pop() ?? fileCode;
    return base.replace(/^[0-9a-f]{40}_/, '');
}

function unique(ids: ID[]): ID[] {
    return ids.filter((id, i) => ids.findIndex(other => idsAreEqual(other, id)) === i);
}

function sameIds(a: ID[], b: ID[]): boolean {
    return a.length === b.length && a.every((id, i) => idsAreEqual(id, b[i]));
}
