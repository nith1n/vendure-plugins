import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FILES, PNG } from './fake-akeneo/fake-akeneo-data';
import {
    connect,
    createAkeneoTestEnvironment,
    runProductSync,
    saveSyncSettings,
    SETUP_TIMEOUT_MS,
} from './utils/test-environment';

type WithAssets = {
    featuredAsset: { name: string } | null;
    assets: Array<{ id: string; name: string }>;
};
type Product = WithAssets & {
    id: string;
    customFields: { akeneoCode: string | null; akeneoUuid: string | null };
    variants: Array<WithAssets & { sku: string }>;
};

const BELT = '00000000-0000-4000-8000-000000000010';

describe('Image sync', () => {
    const env = createAkeneoTestEnvironment(8104, { maxDownloadBytes: 1024 });
    const { adminClient, akeneo } = env;

    async function product(akeneoId: string): Promise<Product> {
        const { products } = await adminClient.query<{ products: { items: Product[] } }>(PRODUCTS);
        const found = products.items.find(
            p => p.customFields.akeneoCode === akeneoId || p.customFields.akeneoUuid === akeneoId,
        );
        if (!found) throw new Error(`No synced product for ${akeneoId}`);
        return found;
    }
    const names = (entity: WithAssets) => entity.assets.map(a => a.name);

    beforeAll(async () => {
        await env.start();
        await connect(adminClient, akeneo);
        await saveSyncSettings(adminClient, { syncImages: true });
    }, SETUP_TIMEOUT_MS);
    afterAll(() => env.stop());

    it("downloads each family's images: its image attribute first, then the others in attribute order", async () => {
        const status = await runProductSync(adminClient);
        // shirt.png, shirt_red.png, the asset's front.png and belt.png, each downloaded once
        expect(status.images).toMatchObject({ downloaded: 4, skipped: 0, failed: 0 });

        const shirt = await product('shirt');
        // `image` is the family's image attribute; the `gallery` asset collection follows
        expect(names(shirt)).toEqual(['shirt.png', 'Shirt front']);
        expect(shirt.featuredAsset?.name).toBe('shirt.png');
        expect(names(await product(BELT))).toEqual(['belt.png']);
    });

    it('gives variants their own images only where they differ from the product', async () => {
        const shirt = await product('shirt');
        const variant = (sku: string) => shirt.variants.find(v => v.sku === sku);
        // The red sub model has its own image; the blue one inherits the product's
        expect(names(variant('shirt-red-s') ?? { assets: [], featuredAsset: null })).toEqual([
            'shirt_red.png',
            'Shirt front',
        ]);
        expect(variant('shirt-red-s')?.featuredAsset?.name).toBe('shirt_red.png');
        expect(variant('shirt-blue-s')?.assets).toEqual([]);
    });

    it('reuses downloaded images and changes nothing on a second run', async () => {
        const status = await runProductSync(adminClient);
        expect(status.images).toMatchObject({ downloaded: 0, reused: 4, assigned: 0 });
    });

    it('keeps images added in Vendure, after the Akeneo images', async () => {
        const file = path.join(mkdtempSync(path.join(tmpdir(), 'akeneo-e2e-')), 'hand-made.png');
        writeFileSync(file, PNG);
        const { createAssets } = (await adminClient.fileUploadMutation({
            mutation: CREATE_ASSETS,
            filePaths: [file],
            mapVariables: () => ({ input: [{ file: null }] }),
        })) as { createAssets: Array<{ id: string }> };
        const handMade = createAssets[0];
        const belt = await product(BELT);
        await adminClient.query(UPDATE_PRODUCT, {
            input: {
                id: belt.id,
                assetIds: [handMade.id, ...belt.assets.map(a => a.id)],
                featuredAssetId: handMade.id,
            },
        });

        // A new image in Akeneo changes the Akeneo images, which go first
        const akeneoBelt = akeneo.data.products.find(p => p.uuid === BELT);
        akeneoBelt?.values.image.splice(0, 1, { locale: null, scope: null, data: FILES.front });
        await runProductSync(adminClient);
        const synced = await product(BELT);
        // The same file as the shirt's "Shirt front" asset: that Vendure asset is reused, not downloaded again
        expect(names(synced)).toEqual(['Shirt front', 'hand-made.png']);
        // The featured image chosen in Vendure stays
        expect(synced.featuredAsset?.name).toBe('hand-made.png');
    });

    it('uses the images of a family override, in its order', async () => {
        const akeneoBelt = akeneo.data.products.find(p => p.uuid === BELT);
        if (!akeneoBelt) throw new Error('fixture changed');
        akeneoBelt.values.detail_image = [{ locale: null, scope: null, data: FILES.poster }];
        await saveSyncSettings(adminClient, {
            syncImages: true,
            familyOverrides: [{ family: 'accessories', imageAttributes: ['detail_image', 'image'] }],
        });
        await runProductSync(adminClient);
        expect(names(await product(BELT))).toEqual(['poster.png', 'Shirt front', 'hand-made.png']);
    });

    it('skips files over the download limit, with or without a declared size', async () => {
        const akeneoBelt = akeneo.data.products.find(p => p.uuid === BELT);
        if (!akeneoBelt) throw new Error('fixture changed');
        akeneoBelt.values.image = [{ locale: null, scope: null, data: FILES.large }];
        akeneoBelt.values.detail_image = [{ locale: null, scope: null, data: FILES.largeChunked }];
        const status = await runProductSync(adminClient);
        expect(status).toMatchObject({ state: 'COMPLETED', error: null });
        expect(status.images).toMatchObject({ skipped: 2, failed: 0 });
        // Neither file became an asset; the belt keeps only the image added in Vendure
        expect(names(await product(BELT))).toEqual(['hand-made.png']);
    });

    it('skips Asset Manager assets whose image is only a link', async () => {
        akeneo.data.assetFamilyAttributes.packshots[1].type = 'media_link';
        const status = await runProductSync(adminClient);
        expect(status.images.skipped).toBeGreaterThan(0);
        expect(names(await product('shirt'))).toEqual(['shirt.png']);
    });
});

const PRODUCTS = gql`
    query Products {
        products(options: { take: 100 }) {
            items {
                id
                customFields {
                    akeneoCode
                    akeneoUuid
                }
                featuredAsset {
                    name
                }
                assets {
                    id
                    name
                }
                variants {
                    sku
                    featuredAsset {
                        name
                    }
                    assets {
                        id
                        name
                    }
                }
            }
        }
    }
`;

const CREATE_ASSETS = gql`
    mutation CreateAssets($input: [CreateAssetInput!]!) {
        createAssets(input: $input) {
            ... on Asset {
                id
                name
            }
        }
    }
`;

const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`;
