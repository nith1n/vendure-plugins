import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
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

    @Column({ type: 'timestamp', nullable: true })
    lastValidatedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    lastValidationError: string | null;
}
