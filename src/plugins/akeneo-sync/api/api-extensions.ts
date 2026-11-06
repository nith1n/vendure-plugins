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
        "Text attribute used as product name; null uses each family's label attribute"
        productNameAttribute: String
        "Text attribute used as product description; null leaves descriptions to Vendure"
        productDescriptionAttribute: String
        "Price collection attribute used as variant prices; null leaves prices to Vendure"
        productPriceAttribute: String
        "Sync images from each family's image attributes; when false, assets are left to Vendure"
        syncImages: Boolean!
        "Attributes for families that differ from the defaults"
        familyOverrides: [AkeneoFamilyOverride!]!
    }

    "Attributes of one Akeneo family; null or empty uses the default"
    type AkeneoFamilyOverride {
        family: String!
        nameAttribute: String
        descriptionAttribute: String
        priceAttribute: String
        "In order; the first image found is featured"
        imageAttributes: [String!]!
    }

    type AkeneoFamilyOption {
        code: String!
        label: String!
        "Codes of the family's attributes"
        attributes: [String!]!
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

    "Latest product sync run of the active channel"
    type AkeneoProductSyncStatus {
        runId: String!
        state: AkeneoSyncRunState!
        pages: Int!
        "Akeneo products processed; each becomes one Vendure variant"
        products: Int!
        created: Int!
        updated: Int!
        unchanged: Int!
        "Vendure Products created (one per root product model or simple product)"
        productsCreated: Int!
        images: AkeneoImageSyncCounts!
        startedAt: DateTime!
        finishedAt: DateTime
        error: String
    }

    "Image downloads of a product sync run, summed over its asset jobs"
    type AkeneoImageSyncCounts {
        "New Vendure Assets downloaded from Akeneo"
        downloaded: Int!
        "Images already in Vendure"
        reused: Int!
        "Products and variants whose Akeneo images changed"
        assigned: Int!
        "Media links, missing assets and unsupported files"
        skipped: Int!
        "Asset jobs still queued or running"
        pending: Int!
        "Asset jobs that failed"
        failed: Int!
    }

    enum AkeneoCleanupMode {
        "Finds leftovers without changing anything"
        SCAN
        "Removes the leftovers of a scan that a fresh scan still finds"
        REMOVE
    }

    type AkeneoCleanupKind {
        count: Int!
        "A few names, for the preview"
        examples: [String!]!
    }

    "A leftover that cleanup leaves alone, and why"
    type AkeneoCleanupKept {
        kind: String!
        name: String!
        reason: String!
    }

    type AkeneoCleanupPlan {
        "Products no longer in the Akeneo channel (soft-deleted with their variants)"
        products: AkeneoCleanupKind!
        "Variants no longer in Akeneo, of products that stay"
        variants: AkeneoCleanupKind!
        "Collections of categories that are no longer synced, with their descendants"
        collections: AkeneoCleanupKind!
        "Akeneo images nothing uses"
        assets: AkeneoCleanupKind!
        kept: [AkeneoCleanupKept!]!
    }

    type AkeneoCleanupRemoved {
        products: Int!
        variants: Int!
        collections: Int!
        assets: Int!
    }

    "Latest cleanup job of the active channel"
    type AkeneoCleanupStatus {
        jobId: ID!
        mode: AkeneoCleanupMode!
        state: AkeneoSyncRunState!
        startedAt: DateTime!
        finishedAt: DateTime
        error: String
        "What the scan found, or what a remove job worked on"
        plan: AkeneoCleanupPlan
        removed: AkeneoCleanupRemoved
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
        "Null uses each family's label attribute"
        productNameAttribute: String
        "Null leaves descriptions to Vendure"
        productDescriptionAttribute: String
        "Null leaves prices to Vendure"
        productPriceAttribute: String
        "Sync images from each family's image attributes"
        syncImages: Boolean
        familyOverrides: [AkeneoFamilyOverrideInput!]
    }

    input AkeneoFamilyOverrideInput {
        family: String!
        nameAttribute: String
        descriptionAttribute: String
        priceAttribute: String
        imageAttributes: [String!]
    }

    type AkeneoAttributeChoice {
        code: String!
        label: String!
        type: String!
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
        "Text, textarea, price, image and asset collection attributes of the connected Akeneo instance, read live"
        akeneoAttributeChoices: [AkeneoAttributeChoice!]!
        "Families of the connected Akeneo instance, read live"
        akeneoFamilies: [AkeneoFamilyOption!]!
        "Null if no category sync has run for this channel yet"
        akeneoCategorySyncStatus: AkeneoCategorySyncStatus
        "Null if no product sync has run for this channel yet"
        akeneoProductSyncStatus: AkeneoProductSyncStatus
        "Null if no cleanup has run for this channel yet"
        akeneoCleanupStatus: AkeneoCleanupStatus
    }

    extend type Mutation {
        saveAkeneoConnectionSettings(input: SaveAkeneoConnectionSettingsInput!): AkeneoConnectionSettings!
        validateAkeneoCredentials(input: ValidateAkeneoCredentialsInput): AkeneoCredentialValidationResult!
        deleteAkeneoConnectionSettings: DeletionResponse!
        saveAkeneoSyncSettings(input: SaveAkeneoSyncSettingsInput!): AkeneoConnectionSettings!
        "Queues a sync of the selected Akeneo category trees to Collections, one page per job."
        startAkeneoCategorySync: Job!
        "Queues a sync of the Akeneo channel's products to Products and ProductVariants, one page per job."
        startAkeneoProductSync: Job!
        "Queues a scan for synced items Akeneo no longer has. Changes nothing."
        scanAkeneoLeftovers: Job!
        "Queues removal of what the given scan found and a fresh scan still finds."
        removeAkeneoLeftovers(scanJobId: ID!): Job!
    }
`;
