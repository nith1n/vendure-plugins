import { LanguageCode } from '@vendure/common/lib/generated-types';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UPDATED } from './fake-akeneo/fake-akeneo-data';
import {
    connect,
    createAkeneoTestEnvironment,
    runCategorySync,
    runProductSync,
    saveSyncSettings,
    SETUP_TIMEOUT_MS,
} from './utils/test-environment';

type Variant = {
    sku: string;
    name: string;
    enabled: boolean;
    prices: Array<{ currencyCode: string; price: number }>;
    options: Array<{ code: string; group: { code: string } }>;
    customFields: { akeneoUuid: string | null };
};
type Product = {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    customFields: { akeneoCode: string | null; akeneoUuid: string | null };
    variants: Variant[];
};

describe('Product sync', () => {
    const env = createAkeneoTestEnvironment(8103);
    const { adminClient, akeneo } = env;

    async function syncedProducts(): Promise<Product[]> {
        const { products } = await adminClient.query<{ products: { items: Product[] } }>(PRODUCTS);
        return products.items.filter(p => p.customFields.akeneoCode || p.customFields.akeneoUuid);
    }
    async function product(akeneoId: string): Promise<Product> {
        const found = (await syncedProducts()).find(
            p => p.customFields.akeneoCode === akeneoId || p.customFields.akeneoUuid === akeneoId,
        );
        if (!found) throw new Error(`No synced product for ${akeneoId}`);
        return found;
    }
    function touch(entity: { updated: string }) {
        entity.updated = new Date().toISOString();
    }

    beforeAll(async () => {
        await env.start();
        await connect(adminClient, akeneo);
        await saveSyncSettings(adminClient, {
            productDescriptionAttribute: 'description',
            productPriceAttribute: 'price',
        });
        await runCategorySync(adminClient);
    }, SETUP_TIMEOUT_MS);
    afterAll(() => env.stop());

    it('offers "sync changes" only after a completed full sync', async () => {
        await expect(runProductSync(adminClient, true)).rejects.toThrow('Run a full sync first');
    });

    it('syncs the channel tree: a model with variants and a simple product', async () => {
        const status = await runProductSync(adminClient);
        // The poster is outside the ecommerce channel's category tree
        expect(status).toMatchObject({
            state: 'COMPLETED',
            products: 4,
            created: 4,
            productsCreated: 2,
            skipped: 0,
            error: null,
        });
        expect((await syncedProducts()).map(p => p.name).sort()).toEqual(['Leather belt', 'Shirt']);
    });

    it('turns a two-level product model into one product with an option group per axis', async () => {
        const shirt = await product('shirt');
        expect(shirt.description).toBe('A cotton shirt');
        expect(
            shirt.variants
                .map(v => ({
                    sku: v.sku,
                    name: v.name,
                    options: v.options.map(o => `${o.group.code}:${o.code}`).sort(),
                }))
                .sort((a, b) => a.sku.localeCompare(b.sku)),
        ).toEqual([
            { sku: 'shirt-blue-s', name: 'Shirt Blue S', options: ['color:blue', 'size:s'] },
            { sku: 'shirt-red-m', name: 'Shirt Red M', options: ['color:red', 'size:m'] },
            { sku: 'shirt-red-s', name: 'Shirt Red S', options: ['color:red', 'size:s'] },
        ]);
    });

    it("copies prices in the channel's currencies only", async () => {
        const belt = await product('00000000-0000-4000-8000-000000000010');
        expect(belt.variants).toHaveLength(1);
        // EUR isn't a currency of the channel
        expect(belt.variants[0].prices).toEqual([{ currencyCode: 'USD', price: 2550 }]);
        const shirt = await product('shirt');
        expect(shirt.variants.find(v => v.sku === 'shirt-blue-s')?.prices).toEqual([
            { currencyCode: 'USD', price: 2150 },
        ]);
    });

    it('adds the variants to the collections of their categories', async () => {
        const { collections } = await adminClient.query<{
            collections: {
                items: Array<{
                    customFields: { akeneoCode: string | null };
                    productVariants: { items: Array<{ sku: string }> };
                }>;
            };
        }>(COLLECTION_VARIANTS);
        const skus = (code: string) =>
            collections.items
                .find(c => c.customFields.akeneoCode === code)
                ?.productVariants.items.map(v => v.sku)
                .sort();
        expect(skus('shirts')).toEqual(['shirt-blue-s', 'shirt-red-m', 'shirt-red-s']);
        // A parent category's collection includes its descendants' products
        expect(skus('clothing')).toEqual(['shirt-blue-s', 'shirt-red-m', 'shirt-red-s']);
        expect(skus('accessories')).toEqual(['belt']);
    });

    it('reports everything unchanged on a second run', async () => {
        const status = await runProductSync(adminClient);
        expect(status).toMatchObject({ created: 0, updated: 0, unchanged: 4, productsUpdated: 0 });
    });

    it('updates names changed on the product model, on the product and its variants', async () => {
        const model = akeneo.data.productModels.find(m => m.code === 'shirt');
        if (!model) throw new Error('fixture changed');
        model.values.name = [{ locale: 'en_US', scope: null, data: 'Oxford shirt' }];
        touch(model);
        const status = await runProductSync(adminClient);
        expect(status).toMatchObject({ updated: 3, unchanged: 1, productsUpdated: 1 });
        const shirt = await product('shirt');
        expect(shirt.name).toBe('Oxford shirt');
        expect(shirt.variants.map(v => v.name).sort()).toEqual([
            'Oxford shirt Blue S',
            'Oxford shirt Red M',
            'Oxford shirt Red S',
        ]);
    });

    it('fetches only products changed in Akeneo with "sync changes"', async () => {
        // The shirt was changed moments ago, inside the overlap with the last run; date it back
        const shirt = akeneo.data.productModels.find(m => m.code === 'shirt');
        if (shirt) shirt.updated = UPDATED;
        const unchanged = await runProductSync(adminClient, true);
        expect(unchanged.products).toBe(0);
        expect(unchanged.changesSince).not.toBeNull();

        const belt = akeneo.data.products.find(p => p.identifier === 'belt');
        if (!belt) throw new Error('fixture changed');
        belt.values.name = [{ locale: 'en_US', scope: null, data: 'Braided belt' }];
        touch(belt);
        const status = await runProductSync(adminClient, true);
        expect(status).toMatchObject({ products: 1, productsUpdated: 1 });
        expect((await product(belt.uuid)).name).toBe('Braided belt');

        // The request asked Akeneo for products updated since the last run
        const lastProductsRequest = akeneo.requestsTo('/api/rest/v1/products-uuid').pop();
        expect(lastProductsRequest?.searchParams.get('search')).toContain('"updated"');
    });

    it('requires a full sync again after the product settings change', async () => {
        await saveSyncSettings(adminClient, {
            productDescriptionAttribute: null,
            productPriceAttribute: 'price',
        });
        await expect(runProductSync(adminClient, true)).rejects.toThrow('Run a full sync first');
        await saveSyncSettings(adminClient, {
            productDescriptionAttribute: 'description',
            productPriceAttribute: 'price',
        });
    });

    it('keeps a product disabled in Vendure disabled, until Akeneo changes its variants', async () => {
        const belt = await product('00000000-0000-4000-8000-000000000010');
        await adminClient.query(UPDATE_PRODUCT, { input: { id: belt.id, enabled: false } });
        await runProductSync(adminClient);
        expect((await product('00000000-0000-4000-8000-000000000010')).enabled).toBe(false);

        // Disabling and re-enabling the variant in Akeneo recalculates the product
        const akeneoBelt = akeneo.data.products.find(p => p.identifier === 'belt');
        if (!akeneoBelt) throw new Error('fixture changed');
        akeneoBelt.enabled = false;
        await runProductSync(adminClient);
        akeneoBelt.enabled = true;
        await runProductSync(adminClient);
        const synced = await product('00000000-0000-4000-8000-000000000010');
        expect(synced.enabled).toBe(true);
        expect(synced.variants[0].enabled).toBe(true);
    });

    it('moves a product that becomes simple in Akeneo out of its model', async () => {
        const blue = akeneo.data.products.find(p => p.identifier === 'shirt-blue-s');
        if (!blue) throw new Error('fixture changed');
        Object.assign(blue, {
            parent: null,
            family: 'accessories',
            categories: ['accessories'],
            values: { ...blue.values, name: [{ locale: 'en_US', scope: null, data: 'Blue shirt' }] },
        });
        const status = await runProductSync(adminClient);
        expect(status.productsCreated).toBe(1);

        expect((await product('shirt')).variants.map(v => v.sku).sort()).toEqual([
            'shirt-red-m',
            'shirt-red-s',
        ]);
        const simple = await product(blue.uuid);
        expect(simple.name).toBe('Blue shirt');
        expect(simple.variants.map(v => [v.sku, v.customFields.akeneoUuid])).toEqual([
            ['shirt-blue-s', blue.uuid],
        ]);
    });

    describe('in a second Vendure channel', () => {
        it('skips products that the first channel synced', async () => {
            const { zones } = await adminClient.query<{ zones: { items: Array<{ id: string }> } }>(ZONES);
            const { createChannel } = await adminClient.query<{
                createChannel: { id: string; token: string };
            }>(CREATE_CHANNEL, {
                input: {
                    code: 'second',
                    token: 'second-token',
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: 'USD',
                    pricesIncludeTax: false,
                    defaultTaxZoneId: zones.items[0].id,
                    defaultShippingZoneId: zones.items[0].id,
                },
            });
            adminClient.setChannelToken(createChannel.token);
            try {
                await connect(adminClient, akeneo);
                await saveSyncSettings(adminClient);
                const status = await runProductSync(adminClient);
                expect(status).toMatchObject({ products: 4, skipped: 4, created: 0, productsCreated: 0 });
                expect(await syncedProducts()).toEqual([]);
            } finally {
                adminClient.setChannelToken('e2e-default-channel');
            }
            // The first channel's products are untouched
            expect((await product('shirt')).name).toBe('Oxford shirt');
        });
    });
});

const PRODUCTS = gql`
    query Products {
        products(options: { take: 100 }) {
            items {
                id
                name
                description
                enabled
                customFields {
                    akeneoCode
                    akeneoUuid
                }
                variants {
                    sku
                    name
                    enabled
                    prices {
                        currencyCode
                        price
                    }
                    options {
                        code
                        group {
                            code
                        }
                    }
                    customFields {
                        akeneoUuid
                    }
                }
            }
        }
    }
`;

const COLLECTION_VARIANTS = gql`
    query CollectionVariants {
        collections(options: { take: 100 }) {
            items {
                customFields {
                    akeneoCode
                }
                productVariants(options: { take: 100 }) {
                    items {
                        sku
                    }
                }
            }
        }
    }
`;

const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            enabled
        }
    }
`;

const ZONES = gql`
    query Zones {
        zones {
            items {
                id
            }
        }
    }
`;

const CREATE_CHANNEL = gql`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
                token
            }
        }
    }
`;
