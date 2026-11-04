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
