import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    enum AkeneoCredentialStatus {
        UNTESTED
        VALID
        INVALID
    }

    """
    Akeneo Cloud API connection settings for the active Channel.
    The client secret and user password are write-only and never returned.
    """
    type AkeneoConnectionSettings implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        baseUrl: String!
        clientId: String!
        username: String!
        hasSecret: Boolean!
        hasPassword: Boolean!
        enabled: Boolean!
        lastValidationStatus: AkeneoCredentialStatus!
        lastValidatedAt: DateTime
        lastValidationError: String
        "Akeneo channel used for values, locales and currencies"
        channelCode: String
        localeMapping: [AkeneoLocaleMapping!]!
        "Root codes of the Akeneo category trees synced as Collections"
        categoryTreeCodes: [String!]!
        "Whether each tree root itself becomes a Collection"
        includeCategoryRoot: Boolean!
    }

    "Which Akeneo locale feeds a Vendure language"
    type AkeneoLocaleMapping {
        languageCode: LanguageCode!
        locale: String!
    }

    type AkeneoChannelOption {
        code: String!
        label: String!
        "Root code of the channel's category tree"
        categoryTree: String!
        locales: [String!]!
    }

    type AkeneoCategoryTreeOption {
        code: String!
        label: String!
    }

    enum AkeneoSyncRunState {
        RUNNING
        COMPLETED
        FAILED
        CANCELLED
    }

    "Latest category sync run of the active channel"
    type AkeneoCategorySyncStatus {
        runId: String!
        state: AkeneoSyncRunState!
        trees: [String!]!
        "Tree being synced while the run is going"
        currentTree: String
        pages: Int!
        categories: Int!
        created: Int!
        updated: Int!
        unchanged: Int!
        startedAt: DateTime!
        finishedAt: DateTime
        error: String
    }

    input AkeneoLocaleMappingInput {
        languageCode: LanguageCode!
        locale: String!
    }

    input SaveAkeneoSyncSettingsInput {
        channelCode: String!
        localeMapping: [AkeneoLocaleMappingInput!]!
        categoryTreeCodes: [String!]!
        includeCategoryRoot: Boolean!
        "When false, no catalog sync runs for this channel"
        enabled: Boolean!
    }

    type AkeneoCredentialValidationResult {
        valid: Boolean!
        status: AkeneoCredentialStatus!
        message: String
        "HTTP status returned by Akeneo, or null if it could not be reached"
        httpStatus: Int
        testedAt: DateTime!
        "True if the result was recorded on the stored connection settings"
        persisted: Boolean!
    }

    input SaveAkeneoConnectionSettingsInput {
        "Origin of the Akeneo instance, e.g. https://acme.cloud.akeneo.com"
        baseUrl: String!
        clientId: String!
        "Required on first save. Omit to keep the stored secret."
        secret: String
        username: String!
        "Required on first save. Omit to keep the stored password."
        password: String
        enabled: Boolean
    }

    """
    Credentials to test. Any omitted field falls back to the stored settings,
    so passing no input tests the saved connection.
    """
    input ValidateAkeneoCredentialsInput {
        baseUrl: String
        clientId: String
        secret: String
        username: String
        password: String
    }

    extend type Query {
        akeneoConnectionSettings: AkeneoConnectionSettings
        "Channels of the connected Akeneo instance, read live"
        akeneoChannels: [AkeneoChannelOption!]!
        "Root categories (one per tree) of the connected Akeneo instance, read live"
        akeneoCategoryTrees: [AkeneoCategoryTreeOption!]!
        "Suggested locale for each language of the active channel"
        akeneoSuggestedLocaleMapping(channelCode: String!): [AkeneoLocaleMapping!]!
        "Null if no category sync has run for this channel yet"
        akeneoCategorySyncStatus: AkeneoCategorySyncStatus
    }

    extend type Mutation {
        saveAkeneoConnectionSettings(input: SaveAkeneoConnectionSettingsInput!): AkeneoConnectionSettings!
        validateAkeneoCredentials(input: ValidateAkeneoCredentialsInput): AkeneoCredentialValidationResult!
        deleteAkeneoConnectionSettings: DeletionResponse!
        saveAkeneoSyncSettings(input: SaveAkeneoSyncSettingsInput!): AkeneoConnectionSettings!
        "Queues a sync of the selected Akeneo category trees to Collections, one page per job."
        startAkeneoCategorySync: Job!
    }
`;
