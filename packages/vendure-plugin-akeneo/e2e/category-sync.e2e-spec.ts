import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    connect,
    createAkeneoTestEnvironment,
    runCategorySync,
    saveSyncSettings,
    SETUP_TIMEOUT_MS,
} from './utils/test-environment';

type CollectionItem = {
    name: string;
    parent: { name: string } | null;
    customFields: { akeneoCode: string | null };
    filters: Array<{ code: string; args: Array<{ name: string; value: string }> }>;
};

const ROOT_COLLECTION = '__root_collection__';

describe('Category sync', () => {
    const env = createAkeneoTestEnvironment(8102);
    const { adminClient, akeneo } = env;

    /** Synced collections by Akeneo code, with their parent's name ('<root>' at the top level). */
    async function syncedTree(): Promise<Record<string, { name: string; parent: string }>> {
        const { collections } = await adminClient.query<{ collections: { items: CollectionItem[] } }>(
            COLLECTIONS,
        );
        return Object.fromEntries(
            collections.items
                .filter(c => c.customFields.akeneoCode)
                .map((c): [string, { name: string; parent: string }] => [
                    c.customFields.akeneoCode ?? '',
                    {
                        name: c.name,
                        parent: c.parent?.name === ROOT_COLLECTION ? '<root>' : (c.parent?.name ?? ''),
                    },
                ]),
        );
    }

    beforeAll(async () => {
        await env.start();
        await connect(adminClient, akeneo);
    }, SETUP_TIMEOUT_MS);
    afterAll(() => env.stop());

    it('refuses to start without a selected tree', async () => {
        await saveSyncSettings(adminClient, { categoryTreeCodes: [] });
        await expect(runCategorySync(adminClient)).rejects.toThrow('Select at least one category tree');
    });

    it('creates collections for the selected tree only, below the root', async () => {
        await saveSyncSettings(adminClient, { categoryTreeCodes: ['master'] });
        const status = await runCategorySync(adminClient);
        expect(status).toMatchObject({ state: 'COMPLETED', created: 3, error: null });
        expect(await syncedTree()).toEqual({
            clothing: { name: 'Clothing', parent: '<root>' },
            shirts: { name: 'Shirts', parent: 'Clothing' },
            accessories: { name: 'Accessories', parent: '<root>' },
        });
    });

    it('gives each collection a filter for its Akeneo category', async () => {
        const { collections } = await adminClient.query<{ collections: { items: CollectionItem[] } }>(
            COLLECTIONS,
        );
        const shirts = collections.items.find(c => c.customFields.akeneoCode === 'shirts');
        expect(shirts?.filters).toEqual([
            {
                code: 'akeneo-category',
                args: [
                    { name: 'categoryCode', value: 'shirts' },
                    { name: 'combineWithAnd', value: 'true' },
                ],
            },
        ]);
    });

    it('reports everything unchanged on a second run', async () => {
        const status = await runCategorySync(adminClient);
        expect(status).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    });

    it('names collections from the mapped locale', async () => {
        await saveSyncSettings(adminClient, {
            localeMapping: [{ languageCode: 'en' as never, locale: 'en_GB' }],
        });
        await runCategorySync(adminClient);
        // en_GB has its own label for clothing; the others fall back to the code
        expect((await syncedTree()).clothing.name).toBe('Clothes');
        await saveSyncSettings(adminClient);
        await runCategorySync(adminClient);
        expect((await syncedTree()).clothing.name).toBe('Clothing');
    });

    it('creates the tree root as a collection when asked, moving its children under it', async () => {
        await saveSyncSettings(adminClient, { includeCategoryRoot: true });
        const status = await runCategorySync(adminClient);
        expect(status.created).toBe(1);
        expect(await syncedTree()).toEqual({
            master: { name: 'Master catalog', parent: '<root>' },
            clothing: { name: 'Clothing', parent: 'Master catalog' },
            shirts: { name: 'Shirts', parent: 'Clothing' },
            accessories: { name: 'Accessories', parent: 'Master catalog' },
        });
    });

    it('follows categories moved and renamed in Akeneo', async () => {
        const shirts = akeneo.data.categories.find(c => c.code === 'shirts');
        if (!shirts) throw new Error('fixture changed');
        shirts.parent = 'accessories';
        shirts.labels = { en_US: 'Shirts & tops' };
        const status = await runCategorySync(adminClient);
        expect(status).toMatchObject({ state: 'COMPLETED', updated: 1, unchanged: 3, error: null });
        expect((await syncedTree()).shirts).toEqual({ name: 'Shirts & tops', parent: 'Accessories' });
    });

    it('syncs a second tree alongside the first', async () => {
        await saveSyncSettings(adminClient, {
            includeCategoryRoot: true,
            categoryTreeCodes: ['master', 'print_catalog'],
        });
        await runCategorySync(adminClient);
        const tree = await syncedTree();
        expect(tree.print_catalog).toEqual({ name: 'Print catalog', parent: '<root>' });
        expect(tree.posters).toEqual({ name: 'Posters', parent: 'Print catalog' });
    });
});

const COLLECTIONS = gql`
    query Collections {
        collections(options: { take: 100 }) {
            items {
                name
                parent {
                    name
                }
                customFields {
                    akeneoCode
                }
                filters {
                    code
                    args {
                        name
                        value
                    }
                }
            }
        }
    }
`;
