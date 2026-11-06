import {
    AkeneoCredentialStatus,
    AkeneoFamilyOverride,
    AkeneoLocaleMapping,
} from './entities/akeneo-connection-settings.entity';

/**
 * @description
 * The plugin can be configured using the following options:
 */
export interface PluginInitOptions {
    /**
     * Key used to encrypt the Akeneo client secret and user password at rest.
     * Should be a long random string (e.g. `openssl rand -base64 32`), read from
     * an environment variable in `vendure-config.ts`. Changing it makes stored
     * credentials unreadable, so they would need to be re-entered.
     */
    encryptionKey?: string;
    /**
     * Allow `http://` Akeneo base URLs. Akeneo Cloud is always served over HTTPS,
     * so this should only be enabled for local/self-hosted test instances.
     *
     * @default false
     */
    allowInsecureBaseUrl?: boolean;
    /**
     * Timeout for each request made to the Akeneo API (file downloads excluded).
     *
     * @default 10000
     */
    requestTimeoutMs?: number;
}

export interface SaveAkeneoConnectionSettingsInput {
    baseUrl: string;
    clientId: string;
    /** Omit (or pass null) to keep the currently stored secret. */
    secret?: string | null;
    username: string;
    /** Omit (or pass null) to keep the currently stored password. */
    password?: string | null;
    enabled?: boolean | null;
}

export interface SaveAkeneoSyncSettingsInput {
    channelCode: string;
    localeMapping: AkeneoLocaleMapping[];
    categoryTreeCodes: string[];
    includeCategoryRoot: boolean;
    enabled: boolean;
    /** Null uses each family's label attribute. */
    productNameAttribute?: string | null;
    /** Null leaves descriptions to Vendure. */
    productDescriptionAttribute?: string | null;
    /** Null leaves prices to Vendure. */
    productPriceAttribute?: string | null;
    syncImages?: boolean | null;
    familyOverrides?: AkeneoFamilyOverride[] | null;
}

export interface AkeneoFamilyOption {
    code: string;
    label: string;
    /** Codes of the family's attributes. */
    attributes: string[];
}

export interface AkeneoAttributeChoice {
    code: string;
    label: string;
    type: string;
}

export interface AkeneoChannelOption {
    code: string;
    label: string;
    categoryTree: string;
    locales: string[];
}

export interface AkeneoCategoryTreeOption {
    code: string;
    label: string;
}

export interface ValidateAkeneoCredentialsInput {
    baseUrl?: string | null;
    clientId?: string | null;
    secret?: string | null;
    username?: string | null;
    password?: string | null;
}

export interface AkeneoCredentials {
    baseUrl: string;
    clientId: string;
    secret: string;
    username: string;
    password: string;
}

export interface AkeneoCredentialValidationResult {
    valid: boolean;
    status: AkeneoCredentialStatus;
    message: string | null;
    httpStatus: number | null;
    testedAt: Date;
    /** Whether the result was written to the stored settings' validation status. */
    persisted: boolean;
}
