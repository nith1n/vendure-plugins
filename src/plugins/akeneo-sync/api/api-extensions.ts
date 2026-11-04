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
    }

    extend type Mutation {
        saveAkeneoConnectionSettings(input: SaveAkeneoConnectionSettingsInput!): AkeneoConnectionSettings!
        validateAkeneoCredentials(input: ValidateAkeneoCredentialsInput): AkeneoCredentialValidationResult!
        deleteAkeneoConnectionSettings: DeletionResponse!
    }
`;
