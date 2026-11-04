import { graphql } from '@/gql';

export const akeneoSettingsFragment = graphql(`
    fragment AkeneoSettings on AkeneoConnectionSettings {
        id
        baseUrl
        clientId
        username
        hasSecret
        hasPassword
        enabled
        lastValidationStatus
        lastValidatedAt
        lastValidationError
        channelCode
        localeMapping {
            languageCode
            locale
        }
        categoryTreeCodes
        includeCategoryRoot
    }
`);

export const akeneoSettingsQuery = graphql(
    `
        query AkeneoConnectionSettings {
            akeneoConnectionSettings {
                ...AkeneoSettings
            }
        }
    `,
    [akeneoSettingsFragment],
);

export const saveAkeneoSettingsMutation = graphql(
    `
        mutation SaveAkeneoConnectionSettings($input: SaveAkeneoConnectionSettingsInput!) {
            saveAkeneoConnectionSettings(input: $input) {
                ...AkeneoSettings
            }
        }
    `,
    [akeneoSettingsFragment],
);

export const validateAkeneoCredentialsMutation = graphql(`
    mutation ValidateAkeneoCredentials($input: ValidateAkeneoCredentialsInput) {
        validateAkeneoCredentials(input: $input) {
            valid
            status
            message
            httpStatus
            testedAt
            persisted
        }
    }
`);

export const akeneoSyncOptionsQuery = graphql(`
    query AkeneoSyncOptions {
        akeneoChannels {
            code
            label
            categoryTree
            locales
        }
        akeneoCategoryTrees {
            code
            label
        }
        activeChannel {
            id
            defaultLanguageCode
            availableLanguageCodes
        }
    }
`);

export const akeneoSuggestedLocaleMappingQuery = graphql(`
    query AkeneoSuggestedLocaleMapping($channelCode: String!) {
        akeneoSuggestedLocaleMapping(channelCode: $channelCode) {
            languageCode
            locale
        }
    }
`);

export const saveAkeneoSyncSettingsMutation = graphql(
    `
        mutation SaveAkeneoSyncSettings($input: SaveAkeneoSyncSettingsInput!) {
            saveAkeneoSyncSettings(input: $input) {
                ...AkeneoSettings
            }
        }
    `,
    [akeneoSettingsFragment],
);

export const akeneoCategorySyncStatusQuery = graphql(`
    query AkeneoCategorySyncStatus {
        akeneoCategorySyncStatus {
            runId
            state
            trees
            currentTree
            pages
            categories
            created
            updated
            unchanged
            startedAt
            finishedAt
            error
        }
    }
`);

export const startAkeneoCategorySyncMutation = graphql(`
    mutation StartAkeneoCategorySync {
        startAkeneoCategorySync {
            id
        }
    }
`);
