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
        productNameAttribute
        productDescriptionAttribute
        productPriceAttribute
        syncImages
        familyOverrides {
            family
            nameAttribute
            descriptionAttribute
            priceAttribute
            imageAttributes
        }
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
        akeneoAttributeChoices {
            code
            label
            type
        }
        akeneoFamilies {
            code
            label
            attributes
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

export const akeneoProductSyncStatusQuery = graphql(`
    query AkeneoProductSyncStatus {
        akeneoProductSyncStatus {
            runId
            state
            pages
            products
            created
            updated
            unchanged
            productsCreated
            skipped
            images {
                downloaded
                reused
                assigned
                skipped
                pending
                failed
            }
            startedAt
            finishedAt
            error
        }
    }
`);

export const startAkeneoProductSyncMutation = graphql(`
    mutation StartAkeneoProductSync {
        startAkeneoProductSync {
            id
        }
    }
`);

export const akeneoCleanupStatusQuery = graphql(`
    query AkeneoCleanupStatus {
        akeneoCleanupStatus {
            jobId
            mode
            state
            startedAt
            finishedAt
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
                collections
                assets
            }
        }
    }
`);

export const scanAkeneoLeftoversMutation = graphql(`
    mutation ScanAkeneoLeftovers {
        scanAkeneoLeftovers {
            id
        }
    }
`);

export const removeAkeneoLeftoversMutation = graphql(`
    mutation RemoveAkeneoLeftovers($scanJobId: ID!) {
        removeAkeneoLeftovers(scanJobId: $scanJobId) {
            id
        }
    }
`);
