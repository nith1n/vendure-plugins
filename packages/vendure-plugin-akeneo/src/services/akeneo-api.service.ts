import { Inject, Injectable } from '@nestjs/common';
import { ID, RequestContext } from '@vendure/core';
import { createHash } from 'crypto';

import { AkeneoApiClient, AkeneoApiError } from '../akeneo/akeneo-api-client';
import { AKENEO_SYNC_PLUGIN_OPTIONS, DEFAULT_REQUEST_TIMEOUT_MS } from '../constants';
import { AkeneoCredentials, PluginInitOptions } from '../types';

import { AkeneoConnectionSettingsService } from './akeneo-connection-settings.service';

const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRIES = 3;
const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Hands out an {@link AkeneoApiClient} for the channel's stored connection. Clients are
 * cached per channel so the access token is reused across jobs, and replaced when the
 * stored credentials change.
 */
@Injectable()
export class AkeneoApiService {
    private readonly clients = new Map<ID, { fingerprint: string; client: AkeneoApiClient }>();

    constructor(
        private connectionSettingsService: AkeneoConnectionSettingsService,
        @Inject(AKENEO_SYNC_PLUGIN_OPTIONS) private options: PluginInitOptions,
    ) {}

    async getClient(ctx: RequestContext): Promise<AkeneoApiClient> {
        const credentials = await this.connectionSettingsService.getCredentials(ctx);
        if (!credentials) {
            throw new AkeneoApiError('No Akeneo connection is configured for this channel', null);
        }
        const fingerprint = this.fingerprint(credentials);
        const cached = this.clients.get(ctx.channelId);
        if (cached?.fingerprint === fingerprint) return cached.client;

        const client = new AkeneoApiClient(credentials, {
            timeoutMs: this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
            downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS,
            maxRetries: MAX_RETRIES,
            maxDownloadBytes: this.options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES,
        });
        this.clients.set(ctx.channelId, { fingerprint, client });
        return client;
    }

    private fingerprint(credentials: AkeneoCredentials): string {
        return createHash('sha256').update(JSON.stringify(credentials)).digest('hex');
    }
}
