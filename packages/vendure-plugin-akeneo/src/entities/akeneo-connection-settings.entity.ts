import { DeepPartial, EntityId, ID, LanguageCode, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export enum AkeneoCredentialStatus {
    UNTESTED = 'UNTESTED',
    VALID = 'VALID',
    INVALID = 'INVALID',
}

/**
 * @description
 * Stores the Akeneo Cloud (PIM) REST API connection settings for a Channel.
 *
 * The `secret` and `password` are encrypted at rest (AES-256-GCM) and are never
 * exposed through the GraphQL API. Only `hasSecret` / `hasPassword` flags are returned.
 */
@Entity()
export class AkeneoConnectionSettings extends VendureEntity {
    constructor(input?: DeepPartial<AkeneoConnectionSettings>) {
        super(input);
    }

    /** One connection per Channel. */
    @Index({ unique: true })
    @EntityId()
    channelId: ID;

    /** Normalized origin of the Akeneo instance, e.g. `https://acme.cloud.akeneo.com` */
    @Column({ type: 'varchar', length: 255 })
    baseUrl: string;

    /** OAuth client id of the Akeneo connection (Connect > Connection settings). */
    @Column({ type: 'varchar', length: 255 })
    clientId: string;

    /** Encrypted OAuth client secret. */
    @Column({ type: 'text' })
    encryptedSecret: string;

    /** Username of the Akeneo API connection user. */
    @Column({ type: 'varchar', length: 255 })
    username: string;

    /** Encrypted password of the Akeneo API connection user. */
    @Column({ type: 'text' })
    encryptedPassword: string;

    @Column({ type: 'boolean', default: true })
    enabled: boolean;

    @Column({ type: 'varchar', length: 16, default: AkeneoCredentialStatus.UNTESTED })
    lastValidationStatus: AkeneoCredentialStatus;

    @Column({ type: Date, nullable: true })
    lastValidatedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    lastValidationError: string | null;

    /** Akeneo channel whose values, locales and currencies are used for this Vendure channel. */
    @Column({ type: 'varchar', length: 255, nullable: true })
    channelCode: string | null;

    /** Which Akeneo locale feeds each Vendure language. Unmapped languages are not synced. */
    @Column({ type: 'simple-json', default: '[]' })
    localeMapping: AkeneoLocaleMapping[];

    /** Root codes of the Akeneo category trees synced as Collections. */
    @Column({ type: 'simple-json', default: '[]' })
    categoryTreeCodes: string[];

    /** Create the tree root itself as a Collection, rather than starting at its children. */
    @Column({ type: 'boolean', default: false })
    includeCategoryRoot: boolean;

    /** Text attribute used as product name. Null uses each family's label attribute. */
    @Column({ type: 'varchar', length: 255, nullable: true })
    productNameAttribute: string | null;

    /** Text attribute used as product description. Null leaves descriptions to Vendure. */
    @Column({ type: 'varchar', length: 255, nullable: true })
    productDescriptionAttribute: string | null;

    /** Price collection attribute used as variant prices. Null leaves prices to Vendure. */
    @Column({ type: 'varchar', length: 255, nullable: true })
    productPriceAttribute: string | null;

    /**
     * Sync product and variant images from each family's image and asset collection attributes,
     * the family's image attribute first. When off, assets are left to Vendure.
     */
    @Column({ type: 'boolean', default: false })
    syncImages: boolean;

    /** Attributes for families that differ from the defaults above. */
    @Column({ type: 'simple-json', default: '[]' })
    familyOverrides: AkeneoFamilyOverride[];

    /**
     * Start of the last product sync run that completed. A "changes only" run fetches the Akeneo
     * products updated since then.
     */
    @Column({ type: Date, nullable: true })
    productSyncedFrom: Date | null;

    /**
     * The product mapping settings that run used. When they differ from the current ones, only a
     * full sync brings every product up to date.
     */
    @Column({ type: 'varchar', length: 64, nullable: true })
    productSyncFingerprint: string | null;
}

// Type aliases (not interfaces) so they satisfy the job queue's JsonCompatible data constraint
export type AkeneoLocaleMapping = {
    languageCode: LanguageCode;
    locale: string;
};

/** Per-family attributes; null or empty uses the default. */
export type AkeneoFamilyOverride = {
    family: string;
    nameAttribute: string | null;
    descriptionAttribute: string | null;
    priceAttribute: string | null;
    /** In order; the first image found is featured. */
    imageAttributes: string[];
};
