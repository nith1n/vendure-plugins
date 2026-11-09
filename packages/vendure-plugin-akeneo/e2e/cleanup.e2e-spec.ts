import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    awaitRunningJobs,
    connect,
    createAkeneoTestEnvironment,
    runCategorySync,
    runProductSync,
    saveSyncSettings,
    SETUP_TIMEOUT_MS,
} from './utils/test-environment';

type Kind = { count: number; examples: string[] };
type CleanupStatus = {
    jobId: string;
    mode: 'SCAN' | 'REMOVE';
    state: string;
    error: string | null;
    plan: {
        products: Kind;
        variants: Kind;
        options: Kind;
        optionGroups: Kind;
        collections: Kind;
        assets: Kind;
        kept: Array<{ kind: string; name: string; reason: string }>;
    } | null;
    removed: Record<
        'products' | 'variants' | 'options' | 'optionGroups' | 'collections' | 'assets',
        number
    > | null;
};

const NOTHING = { count: 0, examples: [] };

describe('Cleanup', () => {
    const env = createAkeneoTestEnvironment(8105);
    const { adminClient, akeneo } = env;

    async function cleanup(mutation: 'scan' | 'remove', scanJobId?: string): Promise<CleanupStatus> {
        await adminClient.query(mutation === 'scan' ? SCAN : REMOVE, { scanJobId });
        await awaitRunningJobs(adminClient);
        const { akeneoCleanupStatus } = await adminClient.query<{ akeneoCleanupStatus: CleanupStatus }>(
            STATUS,
        );
        return akeneoCleanupStatus;
    }
    function removeFromAkeneo(sku: string) {
        akeneo.data.products = akeneo.data.products.filter(p => p.identifier !== sku);
    }

    beforeAll(async () => {
        await env.start();
        await connect(adminClient, akeneo);
        await saveSyncSettings(adminClient, {
            syncImages: true,
            categoryTreeCodes: ['master', 'print_catalog'],
        });
        await runCategorySync(adminClient);
        await runProductSync(adminClient);
    }, SETUP_TIMEOUT_MS);
    afterAll(() => env.stop());

    it('finds nothing right after a sync', async () => {
        const status = await cleanup('scan');
        expect(status).toMatchObject({ mode: 'SCAN', state: 'COMPLETED', error: null });
        expect(status.plan).toEqual({
            products: NOTHING,
            variants: NOTHING,
            options: NOTHING,
            optionGroups: NOTHING,
            collections: NOTHING,
            assets: NOTHING,
            kept: [],
        });
    });

    it('lists what Akeneo no longer has, and keeps what was added by hand', async () => {
        removeFromAkeneo('belt');
        removeFromAkeneo('shirt-red-m');
        akeneo.data.categories = akeneo.data.categories.filter(c => c.code !== 'accessories');
        await saveSyncSettings(adminClient, { syncImages: true, categoryTreeCodes: ['master'] });
        // A collection made by hand below a collection whose category is gone
        const accessories = await collectionId('accessories');
        await adminClient.query(CREATE_COLLECTION, {
            input: {
                parentId: accessories,
                filters: [],
                translations: [
                    { languageCode: 'en', name: 'Hand picked', slug: 'hand-picked', description: '' },
                ],
            },
        });

        const { plan } = await cleanup('scan');
        expect(plan).toEqual({
            products: { count: 1, examples: ['Leather belt'] },
            // The red M variant, and the size M only it used; the product stays for its other variants
            variants: { count: 1, examples: ['Shirt (shirt-red-m)'] },
            options: { count: 1, examples: ['size: m'] },
            optionGroups: NOTHING,
            // The deselected tree's collection; Accessories holds a collection made by hand
            collections: { count: 1, examples: ['Posters'] },
            // The belt's image; the red shirt's image is still used by the red S variant
            assets: { count: 1, examples: ['belt.png'] },
            kept: [
                { kind: 'collection', name: 'Accessories', reason: 'Contains collections added in Vendure' },
            ],
        });
    });

    it('removes exactly what the scan listed', async () => {
        const scan = await cleanup('scan');
        const status = await cleanup('remove', scan.jobId);
        expect(status).toMatchObject({ mode: 'REMOVE', state: 'COMPLETED', error: null });
        expect(status.removed).toEqual({
            products: 1,
            variants: 1,
            options: 1,
            optionGroups: 0,
            collections: 1,
            assets: 1,
        });

        const { products, collections, assets } = await adminClient.query<{
            products: { items: Array<{ name: string; variants: Array<{ sku: string }> }> };
            collections: { items: Array<{ name: string }> };
            assets: { items: Array<{ name: string }> };
        }>(CATALOG);
        expect(products.items.map(p => p.name)).toEqual(['Shirt']);
        expect(products.items[0].variants.map(v => v.sku).sort()).toEqual(['shirt-blue-s', 'shirt-red-s']);
        expect(collections.items.map(c => c.name)).toEqual(
            expect.arrayContaining(['Accessories', 'Hand picked']),
        );
        expect(collections.items.map(c => c.name)).not.toContain('Posters');
        expect(assets.items.map(a => a.name)).not.toContain('belt.png');
    });

    it('finds only the kept collection afterwards', async () => {
        const { plan } = await cleanup('scan');
        expect(plan?.products).toEqual(NOTHING);
        expect(plan?.collections).toEqual(NOTHING);
        expect(plan?.kept.map(k => k.name)).toEqual(['Accessories']);
    });

    it('leaves alone what is back in Akeneo before the removal runs', async () => {
        const blue = akeneo.data.products.find(p => p.identifier === 'shirt-blue-s');
        if (!blue) throw new Error('fixture changed');
        removeFromAkeneo('shirt-blue-s');
        const scan = await cleanup('scan');
        expect(scan.plan?.variants.examples).toEqual(['Shirt (shirt-blue-s)']);

        akeneo.data.products.push(blue);
        const status = await cleanup('remove', scan.jobId);
        expect(status.removed?.variants).toBe(0);
    });

    it('refuses to mark anything when Akeneo returns no products for the channel', async () => {
        akeneo.data.products = [];
        const status = await cleanup('scan');
        expect(status.state).toBe('FAILED');
        expect(status.error).toContain('Akeneo returned no products');
    });

    async function collectionId(akeneoCode: string): Promise<string> {
        const { collections } = await adminClient.query<{
            collections: { items: Array<{ id: string; customFields: { akeneoCode: string | null } }> };
        }>(COLLECTION_CODES);
        const found = collections.items.find(c => c.customFields.akeneoCode === akeneoCode);
        if (!found) throw new Error(`No collection for ${akeneoCode}`);
        return found.id;
    }
});

const SCAN = gql`
    mutation Scan {
        scanAkeneoLeftovers {
            id
        }
    }
`;

const REMOVE = gql`
    mutation Remove($scanJobId: ID!) {
        removeAkeneoLeftovers(scanJobId: $scanJobId) {
            id
        }
    }
`;

const STATUS = gql`
    query CleanupStatus {
        akeneoCleanupStatus {
            jobId
            mode
            state
            error
            plan {
                products {
                    count
                    examples
                }
                variants {
                    count
                    examples
                }
                options {
                    count
                    examples
                }
                optionGroups {
                    count
                    examples
                }
                collections {
                    count
                    examples
                }
                assets {
                    count
                    examples
                }
                kept {
                    kind
                    name
                    reason
                }
            }
            removed {
                products
                variants
                options
                optionGroups
                collections
                assets
            }
        }
    }
`;

const CATALOG = gql`
    query Catalog {
        products(options: { take: 100 }) {
            items {
                name
                variants {
                    sku
                }
            }
        }
        collections(options: { take: 100 }) {
            items {
                name
            }
        }
        assets(options: { take: 100 }) {
            items {
                name
            }
        }
    }
`;

const COLLECTION_CODES = gql`
    query CollectionCodes {
        collections(options: { take: 100 }) {
            items {
                id
                customFields {
                    akeneoCode
                }
            }
        }
    }
`;

const CREATE_COLLECTION = gql`
    mutation CreateCollection($input: CreateCollectionInput!) {
        createCollection(input: $input) {
            id
        }
    }
`;
