import { LanguageCode } from '@vendure/common/lib/generated-types';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FAKE_CLIENT_ID, FAKE_PASSWORD, FAKE_USERNAME } from './fake-akeneo/fake-akeneo-server';
import {
    connect,
    createAkeneoTestEnvironment,
    SAVE_CONNECTION,
    saveSyncSettings,
    SETUP_TIMEOUT_MS,
} from './utils/test-environment';

describe('Connection and sync settings', () => {
    const env = createAkeneoTestEnvironment(8101);
    const { adminClient, akeneo } = env;

    beforeAll(() => env.start(), SETUP_TIMEOUT_MS);
    afterAll(() => env.stop());

    it('rejects wrong credentials and keeps the connection unsaved', async () => {
        await expect(
            adminClient.query(SAVE_CONNECTION, {
                input: {
                    baseUrl: akeneo.url,
                    clientId: FAKE_CLIENT_ID,
                    secret: 'wrong',
                    username: FAKE_USERNAME,
                    password: FAKE_PASSWORD,
                },
            }),
        ).resolves.toBeDefined();
        const { validateAkeneoCredentials } = await adminClient.query<{
            validateAkeneoCredentials: { valid: boolean; httpStatus: number | null };
        }>(VALIDATE);
        expect(validateAkeneoCredentials.valid).toBe(false);
        expect(validateAkeneoCredentials.httpStatus).toBe(422);
    });

    it('saves a valid connection without returning the secrets', async () => {
        await connect(adminClient, akeneo);
        const { validateAkeneoCredentials } = await adminClient.query<{
            validateAkeneoCredentials: { valid: boolean };
        }>(VALIDATE);
        expect(validateAkeneoCredentials.valid).toBe(true);

        const { akeneoConnectionSettings } = await adminClient.query<{
            akeneoConnectionSettings: { baseUrl: string; hasSecret: boolean; hasPassword: boolean };
        }>(CONNECTION);
        expect(akeneoConnectionSettings).toEqual({ baseUrl: akeneo.url, hasSecret: true, hasPassword: true });
    });

    it('reads its option lists live from Akeneo', async () => {
        const result = await adminClient.query<{
            akeneoChannels: Array<{ code: string; categoryTree: string }>;
            akeneoCategoryTrees: Array<{ code: string }>;
            akeneoFamilies: Array<{ code: string }>;
            akeneoSuggestedLocaleMapping: Array<{ languageCode: string; locale: string }>;
        }>(OPTIONS);
        expect(result.akeneoChannels.map(c => [c.code, c.categoryTree])).toEqual([
            ['ecommerce', 'master'],
            ['print', 'print_catalog'],
        ]);
        expect(result.akeneoCategoryTrees.map(t => t.code)).toEqual(['master', 'print_catalog']);
        expect(result.akeneoFamilies.map(f => f.code)).toEqual(['clothing', 'accessories']);
        // Exact locale match first; en_US comes before en_GB on the channel
        expect(result.akeneoSuggestedLocaleMapping).toEqual([{ languageCode: 'en', locale: 'en_US' }]);
    });

    it('saves valid sync settings', async () => {
        const { saveAkeneoSyncSettings } = await saveSyncSettings(adminClient, {
            syncImages: true,
            familyOverrides: [{ family: 'accessories', imageAttributes: ['detail_image', 'image'] }],
        });
        expect(saveAkeneoSyncSettings).toEqual({
            channelCode: 'ecommerce',
            categoryTreeCodes: ['master'],
            syncImages: true,
            familyOverrides: [
                { family: 'accessories', nameAttribute: null, imageAttributes: ['detail_image', 'image'] },
            ],
        });
    });

    it('drops family overrides without any attribute set', async () => {
        const { saveAkeneoSyncSettings } = await saveSyncSettings(adminClient, {
            familyOverrides: [{ family: 'clothing' }],
        });
        expect(saveAkeneoSyncSettings.familyOverrides).toEqual([]);
    });

    it.each([
        ['an unknown Akeneo channel', { channelCode: 'nope' }, 'Akeneo channel "nope" does not exist'],
        [
            'a locale the channel does not have',
            { localeMapping: [{ languageCode: LanguageCode.en, locale: 'de_DE' }] },
            'Locale "de_DE" is not enabled on Akeneo channel "ecommerce"',
        ],
        [
            'a category that is not a tree root',
            { categoryTreeCodes: ['shirts'] },
            'Not Akeneo category trees: shirts',
        ],
        [
            'a name attribute that is not text',
            { productNameAttribute: 'price' },
            '"price" is not an Akeneo text attribute',
        ],
        [
            'an override attribute outside the family',
            { familyOverrides: [{ family: 'accessories', imageAttributes: ['gallery'] }] },
            '"gallery" is not an attribute of family "accessories"',
        ],
        [
            'a family overridden twice',
            {
                familyOverrides: [
                    { family: 'clothing', nameAttribute: 'name' },
                    { family: 'clothing', nameAttribute: 'name' },
                ],
            },
            'Family "clothing" is overridden more than once',
        ],
    ])('rejects %s', async (_case, input, message) => {
        await expect(saveSyncSettings(adminClient, input)).rejects.toThrow(message);
    });
});

const VALIDATE = gql`
    mutation Validate {
        validateAkeneoCredentials {
            valid
            httpStatus
        }
    }
`;

const CONNECTION = gql`
    query Connection {
        akeneoConnectionSettings {
            baseUrl
            hasSecret
            hasPassword
        }
    }
`;

const OPTIONS = gql`
    query Options {
        akeneoChannels {
            code
            categoryTree
        }
        akeneoCategoryTrees {
            code
        }
        akeneoFamilies {
            code
        }
        akeneoSuggestedLocaleMapping(channelCode: "ecommerce") {
            languageCode
            locale
        }
    }
`;
