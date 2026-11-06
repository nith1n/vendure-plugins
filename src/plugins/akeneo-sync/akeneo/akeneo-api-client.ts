import { Readable } from 'stream';
import { ReadableStream } from 'stream/web';

import { AkeneoCredentials } from '../types';
import { describeNetworkError, firstString, isRecord, requestAkeneoToken } from '../utils/akeneo-oauth';

import {
    AkeneoAsset,
    AkeneoAssetFamily,
    AkeneoAssetFamilyAttribute,
    AkeneoAttribute,
    AkeneoAttributeGroup,
    AkeneoAttributeOption,
    AkeneoCategory,
    AkeneoChannel,
    AkeneoFamily,
    AkeneoFamilyVariant,
    AkeneoListOptions,
    AkeneoPage,
    AkeneoProduct,
    AkeneoProductModel,
    AkeneoSearch,
} from './akeneo-types';

export interface AkeneoApiClientOptions {
    /** Timeout per JSON request. */
    timeoutMs: number;
    /** Timeout for a whole file download, including the body. */
    downloadTimeoutMs: number;
    /** Retries for rate limiting (429), 5xx gateway errors and network failures. */
    maxRetries: number;
}

export interface AkeneoDownload {
    stream: Readable;
    contentType: string | null;
    filename: string | null;
}

export class AkeneoApiError extends Error {
    constructor(
        message: string,
        readonly httpStatus: number | null,
    ) {
        super(message);
        this.name = 'AkeneoApiError';
    }
}

const API_PREFIX = '/api/rest/v1';
const DEFAULT_PAGE_SIZE = 100;
/** Renew the token this long before Akeneo says it expires. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 60_000;

/**
 * Akeneo REST API client for one set of credentials. Caches the access token and
 * renews it before expiry, or once when a request comes back 401.
 *
 * List methods return a single page so that jobs can process one page per batch and
 * store `page.next` as their cursor; pass it to {@link getPage} to continue.
 */
export class AkeneoApiClient {
    private accessToken: { value: string; expiresAt: number } | undefined;
    private pendingToken: Promise<string> | undefined;

    constructor(
        private readonly credentials: AkeneoCredentials,
        private readonly options: AkeneoApiClientOptions,
    ) {}

    channels(options?: AkeneoListOptions): Promise<AkeneoPage<AkeneoChannel>> {
        return this.list('/channels', options);
    }

    categories(options?: AkeneoListOptions): Promise<AkeneoPage<AkeneoCategory>> {
        return this.list('/categories', options);
    }

    async category(code: string): Promise<AkeneoCategory> {
        return (await this.getJson(`${API_PREFIX}/categories/${encodeURIComponent(code)}`)) as AkeneoCategory;
    }

    /** Root categories, i.e. one per category tree. */
    categoryTrees(options?: AkeneoListOptions): Promise<AkeneoPage<AkeneoCategory>> {
        return this.categories({ ...options, search: { is_root: [{ operator: '=', value: true }] } });
    }

    /** All descendants of a tree's root (any depth), excluding the root itself. */
    categoryTreeDescendants(
        rootCode: string,
        options?: AkeneoListOptions,
    ): Promise<AkeneoPage<AkeneoCategory>> {
        return this.categories({ ...options, search: { parent: [{ operator: '=', value: rootCode }] } });
    }

    attributes(options?: AkeneoListOptions): Promise<AkeneoPage<AkeneoAttribute>> {
        return this.list('/attributes', options);
    }

    attributeGroups(options?: AkeneoListOptions): Promise<AkeneoPage<AkeneoAttributeGroup>> {
        return this.list('/attribute-groups', options);
    }

    async attribute(code: string): Promise<AkeneoAttribute> {
        return (await this.getJson(
            `${API_PREFIX}/attributes/${encodeURIComponent(code)}`,
        )) as AkeneoAttribute;
    }

    async attributeOption(attributeCode: string, code: string): Promise<AkeneoAttributeOption> {
        const path = `/attributes/${encodeURIComponent(attributeCode)}/options/${encodeURIComponent(code)}`;
        return (await this.getJson(`${API_PREFIX}${path}`)) as AkeneoAttributeOption;
    }

    async family(code: string): Promise<AkeneoFamily> {
        return (await this.getJson(`${API_PREFIX}/families/${encodeURIComponent(code)}`)) as AkeneoFamily;
    }

    async familyVariant(familyCode: string, code: string): Promise<AkeneoFamilyVariant> {
        const path = `/families/${encodeURIComponent(familyCode)}/variants/${encodeURIComponent(code)}`;
        return (await this.getJson(`${API_PREFIX}${path}`)) as AkeneoFamilyVariant;
    }

    async productModel(code: string): Promise<AkeneoProductModel> {
        return (await this.getJson(
            `${API_PREFIX}/product-models/${encodeURIComponent(code)}`,
        )) as AkeneoProductModel;
    }

    attributeOptions(
        attributeCode: string,
        options?: AkeneoListOptions,
    ): Promise<AkeneoPage<AkeneoAttributeOption>> {
        return this.list(`/attributes/${encodeURIComponent(attributeCode)}/options`, options);
    }

    families(options?: AkeneoListOptions): Promise<AkeneoPage<AkeneoFamily>> {
        return this.list('/families', options);
    }

    familyVariants(
        familyCode: string,
        options?: AkeneoListOptions,
    ): Promise<AkeneoPage<AkeneoFamilyVariant>> {
        return this.list(`/families/${encodeURIComponent(familyCode)}/variants`, options);
    }

    productModels(options?: AkeneoListOptions): Promise<AkeneoPage<AkeneoProductModel>> {
        return this.list('/product-models', options, { pagination_type: 'search_after' });
    }

    products(options?: AkeneoListOptions): Promise<AkeneoPage<AkeneoProduct>> {
        return this.list('/products-uuid', options, { pagination_type: 'search_after' });
    }

    /** Asset Manager assets. This endpoint uses a fixed page size and ignores `limit`. */
    assets(assetFamilyCode: string, search?: AkeneoSearch): Promise<AkeneoPage<AkeneoAsset>> {
        const query: Record<string, string> = {};
        if (search) query.search = JSON.stringify(search);
        return this.getPage(
            `${API_PREFIX}/asset-families/${encodeURIComponent(assetFamilyCode)}/assets`,
            query,
        );
    }

    async asset(assetFamilyCode: string, code: string): Promise<AkeneoAsset> {
        const path = `/asset-families/${encodeURIComponent(assetFamilyCode)}/assets/${encodeURIComponent(code)}`;
        return (await this.getJson(`${API_PREFIX}${path}`)) as AkeneoAsset;
    }

    async assetFamily(code: string): Promise<AkeneoAssetFamily> {
        return (await this.getJson(
            `${API_PREFIX}/asset-families/${encodeURIComponent(code)}`,
        )) as AkeneoAssetFamily;
    }

    async assetFamilyAttribute(assetFamilyCode: string, code: string): Promise<AkeneoAssetFamilyAttribute> {
        const path = `/asset-families/${encodeURIComponent(assetFamilyCode)}/attributes/${encodeURIComponent(code)}`;
        return (await this.getJson(`${API_PREFIX}${path}`)) as AkeneoAssetFamilyAttribute;
    }

    /** Downloads an Asset Manager media file (the `data` of a media file asset value). */
    downloadAssetMediaFile(code: string): Promise<AkeneoDownload> {
        return this.download(`${API_PREFIX}/asset-media-files/${encodeFileCode(code)}`);
    }

    /** Downloads a product media file (the `data` of an image/file attribute value). */
    downloadMediaFile(code: string): Promise<AkeneoDownload> {
        return this.download(`${API_PREFIX}/media-files/${encodeFileCode(code)}/download`);
    }

    /** Fetches a page by path, or by the absolute `next` URL of a previous page. */
    async getPage<T>(pathOrUrl: string, query?: Record<string, string>): Promise<AkeneoPage<T>> {
        const body = await this.getJson(pathOrUrl, query);
        const embedded = isRecord(body) && isRecord(body._embedded) ? body._embedded : undefined;
        if (!embedded || !Array.isArray(embedded.items)) {
            throw new AkeneoApiError(`Unexpected list response from ${pathOrUrl}`, null);
        }
        const links = isRecord(body) && isRecord(body._links) ? body._links : undefined;
        const next =
            links && isRecord(links.next) && typeof links.next.href === 'string' ? links.next.href : null;
        return { items: embedded.items as T[], next };
    }

    /** Iterates over every page, starting from a page returned by one of the list methods. */
    async *pages<T>(first: AkeneoPage<T>): AsyncGenerator<AkeneoPage<T>> {
        let page: AkeneoPage<T> | undefined = first;
        while (page) {
            yield page;
            page = page.next ? await this.getPage<T>(page.next) : undefined;
        }
    }

    async getJson(pathOrUrl: string, query?: Record<string, string>): Promise<unknown> {
        const response = await this.send(pathOrUrl, query, 'application/json', this.options.timeoutMs);
        return response.json() as Promise<unknown>;
    }

    async download(pathOrUrl: string): Promise<AkeneoDownload> {
        const response = await this.send(pathOrUrl, undefined, '*/*', this.options.downloadTimeoutMs);
        if (!response.body) throw new AkeneoApiError(`Empty download from ${pathOrUrl}`, response.status);
        return {
            stream: Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
            contentType: response.headers.get('content-type'),
            filename: parseFilename(response.headers.get('content-disposition')),
        };
    }

    private list<T>(
        path: string,
        options: AkeneoListOptions = {},
        extra: Record<string, string> = {},
    ): Promise<AkeneoPage<T>> {
        const query: Record<string, string> = {
            limit: String(options.limit ?? DEFAULT_PAGE_SIZE),
            ...extra,
        };
        if (options.search) query.search = JSON.stringify(options.search);
        if (options.scope) query.scope = options.scope;
        if (options.locales?.length) query.locales = options.locales.join(',');
        if (options.attributes?.length) query.attributes = options.attributes.join(',');
        return this.getPage<T>(`${API_PREFIX}${path}`, query);
    }

    private async send(
        pathOrUrl: string,
        query: Record<string, string> | undefined,
        accept: string,
        timeoutMs: number,
    ): Promise<Response> {
        const url = this.resolveUrl(pathOrUrl, query);
        let retries = 0;
        let reauthenticated = false;

        for (;;) {
            const token = await this.getAccessToken();
            let response: Response;
            try {
                response = await fetch(url, {
                    headers: { Authorization: `Bearer ${token}`, Accept: accept },
                    redirect: 'manual',
                    signal: AbortSignal.timeout(timeoutMs),
                });
            } catch (e: unknown) {
                if (retries < this.options.maxRetries) {
                    await sleep(backoffMs(retries++));
                    continue;
                }
                const reason =
                    e instanceof Error && e.name === 'TimeoutError'
                        ? `no response within ${timeoutMs}ms`
                        : describeNetworkError(e);
                throw new AkeneoApiError(`Request to ${url.pathname} failed: ${reason}`, null);
            }

            if (response.status === 401 && !reauthenticated) {
                // Token revoked or expired early: get a fresh one and try once more
                reauthenticated = true;
                this.accessToken = undefined;
                await response.body?.cancel();
                continue;
            }
            if (RETRYABLE_STATUSES.has(response.status) && retries < this.options.maxRetries) {
                const delay = retryAfterMs(response.headers.get('retry-after')) ?? backoffMs(retries);
                retries++;
                await response.body?.cancel();
                await sleep(delay);
                continue;
            }
            if (!response.ok) {
                const body: unknown = await response.json().catch(() => undefined);
                const detail =
                    firstString(body, ['message', 'error_description', 'error']) ?? response.statusText;
                throw new AkeneoApiError(
                    `Akeneo returned ${response.status} for ${url.pathname}${detail ? `: ${detail}` : ''}`,
                    response.status,
                );
            }
            return response;
        }
    }

    private getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.accessToken.expiresAt) {
            return Promise.resolve(this.accessToken.value);
        }
        // Share one token request between concurrent callers
        this.pendingToken ??= this.requestToken().finally(() => (this.pendingToken = undefined));
        return this.pendingToken;
    }

    private async requestToken(): Promise<string> {
        const result = await requestAkeneoToken(this.credentials, this.options.timeoutMs);
        if (!result.ok) throw new AkeneoApiError(result.message, result.httpStatus);
        this.accessToken = {
            value: result.token.access_token,
            expiresAt: Date.now() + result.token.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
        };
        return result.token.access_token;
    }

    /**
     * Accepts an API path or an absolute URL from a `_links` href. Absolute URLs must point
     * at the configured instance so stored cursors can't be used to send the token elsewhere.
     */
    private resolveUrl(pathOrUrl: string, query?: Record<string, string>): URL {
        const base = new URL(this.credentials.baseUrl);
        const url = new URL(pathOrUrl, base);
        if (url.origin !== base.origin || !url.pathname.startsWith(`${API_PREFIX}/`)) {
            throw new AkeneoApiError(
                `Refusing to request ${url.href}: not an Akeneo API URL of this instance`,
                null,
            );
        }
        for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
        return url;
    }
}

/** Formats a date for Akeneo `updated` filters (`YYYY-MM-DD HH:mm:ss`, UTC). */
export function updatedSince(date: Date): AkeneoSearch {
    const value = date.toISOString().slice(0, 19).replace('T', ' ');
    return { updated: [{ operator: '>', value }] };
}

function backoffMs(retry: number): number {
    return Math.min(1000 * 2 ** retry, MAX_RETRY_DELAY_MS);
}

function retryAfterMs(header: string | null): number | undefined {
    if (!header) return undefined;
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_DELAY_MS) : undefined;
}

function parseFilename(header: string | null): string | null {
    if (!header) return null;
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (encoded) {
        try {
            return decodeURIComponent(encoded[1]);
        } catch {
            // fall through to the plain filename
        }
    }
    const plain = /filename="?([^";]+)"?/i.exec(header);
    return plain ? plain[1] : null;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** File codes look like `4/e/1/a/<hash>_name.jpg`; their slashes are part of the URL path. */
function encodeFileCode(code: string): string {
    return code.split('/').map(encodeURIComponent).join('/');
}
