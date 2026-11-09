import { Inject, Injectable } from '@nestjs/common';
import {
    InternalServerError,
    Logger,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { AKENEO_SYNC_PLUGIN_OPTIONS, DEFAULT_REQUEST_TIMEOUT_MS, loggerCtx } from '../constants';
import {
    AkeneoConnectionSettings,
    AkeneoCredentialStatus,
} from '../entities/akeneo-connection-settings.entity';
import {
    AkeneoCredentials,
    AkeneoCredentialValidationResult,
    PluginInitOptions,
    SaveAkeneoConnectionSettingsInput,
    ValidateAkeneoCredentialsInput,
} from '../types';
import { requestAkeneoToken } from '../utils/akeneo-oauth';
import { SecretCipher } from '../utils/secret-cipher';

const MAX_FIELD_LENGTH = 255;
/** Shorter keys are easier to guess; the key is hashed to 256 bits either way. */
const MIN_KEY_LENGTH = 32;

@Injectable()
export class AkeneoConnectionSettingsService {
    private readonly cipher: SecretCipher | undefined;

    constructor(
        private connection: TransactionalConnection,
        @Inject(AKENEO_SYNC_PLUGIN_OPTIONS) private options: PluginInitOptions,
    ) {
        if (options.encryptionKey) {
            this.cipher = new SecretCipher(options.encryptionKey);
            if (options.encryptionKey.length < MIN_KEY_LENGTH) {
                Logger.warn(
                    `The Akeneo encryptionKey is shorter than ${MIN_KEY_LENGTH} characters. ` +
                        'Use a long random value, e.g. from `openssl rand -base64 32`.',
                    loggerCtx,
                );
            }
        } else {
            Logger.warn(
                'No encryptionKey configured (AKENEO_ENCRYPTION_KEY). Akeneo credentials cannot be saved or read.',
                loggerCtx,
            );
        }
    }

    findForChannel(ctx: RequestContext): Promise<AkeneoConnectionSettings | null> {
        return this.connection
            .getRepository(ctx, AkeneoConnectionSettings)
            .findOne({ where: { channelId: ctx.channelId } });
    }

    async save(
        ctx: RequestContext,
        input: SaveAkeneoConnectionSettingsInput,
    ): Promise<AkeneoConnectionSettings> {
        const cipher = this.getCipher();
        const existing = await this.findForChannel(ctx);

        const baseUrl = this.normalizeBaseUrl(input.baseUrl);
        const clientId = this.requireField('clientId', input.clientId);
        const username = this.requireField('username', input.username);
        const secret = this.optionalField('secret', input.secret);
        const password = this.optionalField('password', input.password);

        if (!existing && (!secret || !password)) {
            throw new UserInputError(
                'Both secret and password are required when creating Akeneo connection settings',
            );
        }
        // The stored secret and password may only ever go to the host they were entered for
        if (existing && existing.baseUrl !== baseUrl && (!secret || !password)) {
            throw new UserInputError('Enter the secret and password again when changing the Akeneo URL');
        }

        const settings = existing ?? new AkeneoConnectionSettings({ channelId: ctx.channelId });
        const credentialsChanged =
            !existing ||
            existing.baseUrl !== baseUrl ||
            existing.clientId !== clientId ||
            existing.username !== username ||
            !!secret ||
            !!password;

        if (existing && existing.baseUrl !== baseUrl) {
            // Channel, locale and tree codes belong to the previous Akeneo instance
            settings.channelCode = null;
            settings.localeMapping = [];
            settings.categoryTreeCodes = [];
        }
        settings.baseUrl = baseUrl;
        settings.clientId = clientId;
        settings.username = username;
        if (secret) settings.encryptedSecret = cipher.encrypt(secret);
        if (password) settings.encryptedPassword = cipher.encrypt(password);
        if (input.enabled != null) settings.enabled = input.enabled;
        else if (!existing) settings.enabled = true;

        if (credentialsChanged) {
            settings.lastValidationStatus = AkeneoCredentialStatus.UNTESTED;
            settings.lastValidatedAt = null;
            settings.lastValidationError = null;
        }

        return this.connection.getRepository(ctx, AkeneoConnectionSettings).save(settings);
    }

    async delete(ctx: RequestContext): Promise<boolean> {
        const existing = await this.findForChannel(ctx);
        if (!existing) return false;
        await this.connection.getRepository(ctx, AkeneoConnectionSettings).remove(existing);
        return true;
    }

    /**
     * Tests credentials against Akeneo's OAuth token endpoint.
     *
     * Any field not supplied in `input` falls back to the stored settings, so the
     * dashboard can test edited values without re-entering secrets. The outcome is
     * persisted to the stored settings only when the tested credentials are exactly
     * the stored ones.
     */
    async validate(
        ctx: RequestContext,
        input?: ValidateAkeneoCredentialsInput | null,
    ): Promise<AkeneoCredentialValidationResult> {
        const stored = await this.findForChannel(ctx);
        const storedCredentials = stored ? this.decryptCredentials(stored) : undefined;
        const given = (key: keyof AkeneoCredentials) => {
            const value = input?.[key];
            return value != null && value.trim() !== '' ? value : undefined;
        };
        // Stored values may only be sent to the stored host: testing another URL needs the
        // secret and password entered again, or they could be sent to any server
        const testsStoredHost =
            !given('baseUrl') || this.normalizeBaseUrl(given('baseUrl') as string) === stored?.baseUrl;
        const pick = (key: keyof AkeneoCredentials) =>
            given(key) ??
            (testsStoredHost || key === 'clientId' || key === 'username'
                ? storedCredentials?.[key]
                : undefined);
        const candidate: Partial<AkeneoCredentials> = {
            baseUrl: pick('baseUrl'),
            clientId: pick('clientId'),
            secret: pick('secret'),
            username: pick('username'),
            password: pick('password'),
        };
        const missing = (Object.keys(candidate) as Array<keyof AkeneoCredentials>).filter(k => !candidate[k]);
        if (!testsStoredHost && (missing.includes('secret') || missing.includes('password'))) {
            throw new UserInputError('Enter the secret and password again to test another Akeneo URL');
        }
        if (missing.length) {
            throw new UserInputError(`Missing Akeneo credentials: ${missing.join(', ')}`);
        }
        const credentials: AkeneoCredentials = {
            ...(candidate as AkeneoCredentials),
            baseUrl: this.normalizeBaseUrl(candidate.baseUrl!),
            clientId: candidate.clientId!.trim(),
            username: candidate.username!.trim(),
        };

        const result = await requestAkeneoToken(
            credentials,
            this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        );
        const testedAt = new Date();
        const status = result.ok ? AkeneoCredentialStatus.VALID : AkeneoCredentialStatus.INVALID;
        const message = result.ok ? null : result.message;

        const persisted =
            !!stored && !!storedCredentials && this.sameCredentials(storedCredentials, credentials);
        if (persisted) {
            stored.lastValidationStatus = status;
            stored.lastValidatedAt = testedAt;
            stored.lastValidationError = message;
            await this.connection.getRepository(ctx, AkeneoConnectionSettings).save(stored);
        }
        if (!result.ok) {
            Logger.verbose(`Akeneo credential validation failed: ${result.message}`, loggerCtx);
        }

        return { valid: result.ok, status, message, httpStatus: result.httpStatus, testedAt, persisted };
    }

    /**
     * Returns the decrypted credentials for the current Channel. Intended for use by
     * the sync job processors; never expose the result via the API.
     */
    async getCredentials(ctx: RequestContext): Promise<AkeneoCredentials | undefined> {
        const stored = await this.findForChannel(ctx);
        return stored ? this.decryptCredentials(stored) : undefined;
    }

    private decryptCredentials(settings: AkeneoConnectionSettings): AkeneoCredentials {
        const cipher = this.getCipher();
        try {
            return {
                baseUrl: settings.baseUrl,
                clientId: settings.clientId,
                username: settings.username,
                secret: cipher.decrypt(settings.encryptedSecret),
                password: cipher.decrypt(settings.encryptedPassword),
            };
        } catch (e: unknown) {
            const reason = e instanceof Error ? e.message : String(e);
            Logger.error(`Failed to decrypt stored Akeneo credentials: ${reason}`, loggerCtx);
            throw new InternalServerError(
                'Stored Akeneo credentials could not be decrypted. Was the encryption key changed? Re-enter the secret and password.',
            );
        }
    }

    private sameCredentials(a: AkeneoCredentials, b: AkeneoCredentials): boolean {
        return (
            a.baseUrl === b.baseUrl &&
            a.clientId === b.clientId &&
            a.secret === b.secret &&
            a.username === b.username &&
            a.password === b.password
        );
    }

    private getCipher(): SecretCipher {
        if (!this.cipher) {
            throw new InternalServerError(
                'AkeneoSyncPlugin has no encryptionKey configured. Set AKENEO_ENCRYPTION_KEY and restart the server.',
            );
        }
        return this.cipher;
    }

    /** Validates and reduces the URL to its origin, e.g. `https://acme.cloud.akeneo.com`. */
    private normalizeBaseUrl(raw: string): string {
        const value = this.requireField('baseUrl', raw, 2048);
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            throw new UserInputError(`"${value}" is not a valid URL`);
        }
        const allowed = this.options.allowInsecureBaseUrl ? ['https:', 'http:'] : ['https:'];
        if (!allowed.includes(url.protocol)) {
            throw new UserInputError('The Akeneo base URL must use https://');
        }
        if (url.username || url.password) {
            throw new UserInputError('The Akeneo base URL must not contain credentials');
        }
        if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
            throw new UserInputError(
                'The Akeneo base URL should only contain the host, e.g. https://acme.cloud.akeneo.com',
            );
        }
        return url.origin;
    }

    private requireField(
        name: string,
        value: string | null | undefined,
        maxLength = MAX_FIELD_LENGTH,
    ): string {
        const trimmed = value?.trim();
        if (!trimmed) {
            throw new UserInputError(`"${name}" is required`);
        }
        if (trimmed.length > maxLength) {
            throw new UserInputError(`"${name}" must be at most ${maxLength} characters`);
        }
        return trimmed;
    }

    private optionalField(name: string, value: string | null | undefined): string | undefined {
        if (value == null || value === '') return undefined;
        if (value.trim() === '') throw new UserInputError(`"${name}" must not be blank`);
        if (value.length > 1024) throw new UserInputError(`"${name}" must be at most 1024 characters`);
        return value;
    }
}
