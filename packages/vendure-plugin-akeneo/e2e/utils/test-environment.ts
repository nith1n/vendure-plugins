import { LanguageCode } from '@vendure/common/lib/generated-types';
import { InitialData, mergeConfig } from '@vendure/core';
import {
    createTestEnvironment,
    registerInitializer,
    SimpleGraphQLClient,
    SqljsInitializer,
    testConfig,
} from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';

import { AkeneoSyncPlugin, AkeneoSyncPluginOptions } from '../../src';
import { catalogFixture } from '../fake-akeneo/fake-akeneo-data';
import {
    FAKE_CLIENT_ID,
    FAKE_PASSWORD,
    FAKE_SECRET,
    FAKE_USERNAME,
    FakeAkeneoServer,
} from '../fake-akeneo/fake-akeneo-server';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

export const SETUP_TIMEOUT_MS = 120_000;

const initialData: InitialData = {
    defaultLanguage: LanguageCode.en,
    defaultZone: 'Europe',
    taxRates: [{ name: 'Standard Tax', percentage: 20 }],
    shippingMethods: [{ name: 'Standard Shipping', price: 500 }],
    paymentMethods: [],
    countries: [{ name: 'United Kingdom', code: 'GB', zone: 'Europe' }],
    collections: [],
};

/**
 * A Vendure server with the plugin, plus a fake Akeneo serving the test catalog. Each spec file
 * gets its own, on its own port.
 */
export function createAkeneoTestEnvironment(port: number, pluginOptions: AkeneoSyncPluginOptions = {}) {
    const akeneo = new FakeAkeneoServer(catalogFixture());
    const env = createTestEnvironment(
        mergeConfig(testConfig, {
            apiOptions: { port },
            plugins: [
                AkeneoSyncPlugin.init({
                    encryptionKey: 'e2e-encryption-key-of-a-reasonable-length',
                    // The fake Akeneo runs on plain http
                    allowInsecureBaseUrl: true,
                    ...pluginOptions,
                }),
            ],
        }),
    );
    return {
        ...env,
        akeneo,
        async start() {
            await akeneo.start();
            await env.server.init({ initialData, customerCount: 0 });
            await env.adminClient.asSuperAdmin();
        },
        async stop() {
            await env.server.destroy();
            await akeneo.stop();
        },
    };
}

/** Resolves once every job has settled, including jobs queued by other jobs. */
export async function awaitRunningJobs(adminClient: SimpleGraphQLClient, timeoutMs = 30_000) {
    const start = Date.now();
    // Give a just-started sync a moment to queue its first job
    await new Promise(resolve => setTimeout(resolve, 100));
    for (;;) {
        const { jobs } = await adminClient.query<{ jobs: { totalItems: number } }>(UNSETTLED_JOBS);
        if (jobs.totalItems === 0) return;
        if (Date.now() - start > timeoutMs) throw new Error('Jobs did not settle in time');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

export async function connect(adminClient: SimpleGraphQLClient, akeneo: FakeAkeneoServer) {
    await adminClient.query(SAVE_CONNECTION, {
        input: {
            baseUrl: akeneo.url,
            clientId: FAKE_CLIENT_ID,
            secret: FAKE_SECRET,
            username: FAKE_USERNAME,
            password: FAKE_PASSWORD,
        },
    });
}

export type SyncSettingsInput = {
    channelCode: string;
    localeMapping: Array<{ languageCode: LanguageCode; locale: string }>;
    categoryTreeCodes: string[];
    includeCategoryRoot: boolean;
    enabled: boolean;
    productNameAttribute?: string | null;
    productDescriptionAttribute?: string | null;
    productPriceAttribute?: string | null;
    syncImages?: boolean;
    familyOverrides?: Array<{
        family: string;
        nameAttribute?: string | null;
        descriptionAttribute?: string | null;
        priceAttribute?: string | null;
        imageAttributes?: string[];
    }>;
};

export const DEFAULT_SYNC_SETTINGS: SyncSettingsInput = {
    channelCode: 'ecommerce',
    localeMapping: [{ languageCode: LanguageCode.en, locale: 'en_US' }],
    categoryTreeCodes: ['master'],
    includeCategoryRoot: false,
    enabled: true,
    productNameAttribute: 'name',
};

export type SavedSyncSettings = {
    channelCode: string;
    categoryTreeCodes: string[];
    syncImages: boolean;
    familyOverrides: Array<{ family: string; nameAttribute: string | null; imageAttributes: string[] }>;
};

export function saveSyncSettings(adminClient: SimpleGraphQLClient, input: Partial<SyncSettingsInput> = {}) {
    return adminClient.query<{ saveAkeneoSyncSettings: SavedSyncSettings }>(SAVE_SYNC_SETTINGS, {
        input: { ...DEFAULT_SYNC_SETTINGS, ...input },
    });
}

export type RunStatus = {
    state: string;
    created: number;
    updated: number;
    unchanged: number;
    error: string | null;
};

export type ProductSyncStatus = RunStatus & {
    products: number;
    productsCreated: number;
    productsUpdated: number;
    skipped: number;
    changesSince: string | null;
    images: { downloaded: number; reused: number; assigned: number; skipped: number; failed: number };
};

export async function runCategorySync(adminClient: SimpleGraphQLClient): Promise<RunStatus> {
    await adminClient.query(START_CATEGORY_SYNC);
    await awaitRunningJobs(adminClient);
    const { akeneoCategorySyncStatus } = await adminClient.query<{ akeneoCategorySyncStatus: RunStatus }>(
        CATEGORY_SYNC_STATUS,
    );
    return akeneoCategorySyncStatus;
}

export async function runProductSync(
    adminClient: SimpleGraphQLClient,
    changesOnly = false,
): Promise<ProductSyncStatus> {
    await adminClient.query(START_PRODUCT_SYNC, { changesOnly });
    await awaitRunningJobs(adminClient);
    const { akeneoProductSyncStatus } = await adminClient.query<{
        akeneoProductSyncStatus: ProductSyncStatus;
    }>(PRODUCT_SYNC_STATUS);
    return akeneoProductSyncStatus;
}

const UNSETTLED_JOBS = gql`
    query UnsettledJobs {
        jobs(options: { filter: { isSettled: { eq: false } } }) {
            totalItems
        }
    }
`;

export const SAVE_CONNECTION = gql`
    mutation SaveConnection($input: SaveAkeneoConnectionSettingsInput!) {
        saveAkeneoConnectionSettings(input: $input) {
            id
            baseUrl
            hasSecret
            hasPassword
            lastValidationStatus
        }
    }
`;

export const SAVE_SYNC_SETTINGS = gql`
    mutation SaveSyncSettings($input: SaveAkeneoSyncSettingsInput!) {
        saveAkeneoSyncSettings(input: $input) {
            channelCode
            categoryTreeCodes
            syncImages
            familyOverrides {
                family
                nameAttribute
                imageAttributes
            }
        }
    }
`;

export const START_CATEGORY_SYNC = gql`
    mutation StartCategorySync {
        startAkeneoCategorySync {
            id
        }
    }
`;

export const CATEGORY_SYNC_STATUS = gql`
    query CategorySyncStatus {
        akeneoCategorySyncStatus {
            state
            created
            updated
            unchanged
            error
        }
    }
`;

export const START_PRODUCT_SYNC = gql`
    mutation StartProductSync($changesOnly: Boolean) {
        startAkeneoProductSync(changesOnly: $changesOnly) {
            id
        }
    }
`;

export const PRODUCT_SYNC_STATUS = gql`
    query ProductSyncStatus {
        akeneoProductSyncStatus {
            state
            products
            created
            updated
            unchanged
            productsCreated
            productsUpdated
            skipped
            changesSince
            error
            images {
                downloaded
                reused
                assigned
                skipped
                failed
            }
        }
    }
`;
