import { AkeneoCredentials } from '../types';

export interface AkeneoTokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string | null;
    refresh_token: string;
}

export type AkeneoTokenResult =
    | { ok: true; token: AkeneoTokenResponse; httpStatus: number }
    | { ok: false; message: string; httpStatus: number | null };

/**
 * Requests an access token from the Akeneo REST API using the password grant
 * (`POST /api/oauth/v1/token`). A successful response proves that the base URL,
 * client id/secret and API user credentials are all valid.
 *
 * @see https://api.akeneo.com/documentation/authentication.html
 */
export async function requestAkeneoToken(
    credentials: AkeneoCredentials,
    timeoutMs: number,
): Promise<AkeneoTokenResult> {
    const basic = Buffer.from(`${credentials.clientId}:${credentials.secret}`, 'utf8').toString('base64');
    let response: Response;
    try {
        response = await fetch(`${credentials.baseUrl}/api/oauth/v1/token`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'password',
                username: credentials.username,
                password: credentials.password,
            }),
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (e: unknown) {
        const message =
            e instanceof Error && e.name === 'TimeoutError'
                ? `Akeneo did not respond within ${timeoutMs}ms`
                : `Could not reach Akeneo: ${describeNetworkError(e)}`;
        return { ok: false, message, httpStatus: null };
    }

    const body: unknown = await response.json().catch(() => undefined);

    if (response.ok && isRecord(body) && typeof body.access_token === 'string') {
        return { ok: true, token: body as unknown as AkeneoTokenResponse, httpStatus: response.status };
    }
    if (response.status >= 300 && response.status < 400) {
        return {
            ok: false,
            message: `Akeneo responded with a redirect (${response.status}). Check the base URL.`,
            httpStatus: response.status,
        };
    }
    if (response.status === 404) {
        return {
            ok: false,
            message: 'Token endpoint not found. Check that the base URL points to your Akeneo instance.',
            httpStatus: response.status,
        };
    }
    const detail =
        firstString(body, ['error_description', 'message', 'error']) ||
        response.statusText ||
        'Unknown error';
    return {
        ok: false,
        message: `Akeneo rejected the credentials (${response.status}): ${detail}`,
        httpStatus: response.status,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function firstString(value: unknown, keys: string[]): string | undefined {
    if (!isRecord(value)) return undefined;
    for (const key of keys) {
        const v = value[key];
        if (typeof v === 'string' && v) return v;
    }
    return undefined;
}

/** fetch() wraps socket errors, so the useful code (ENOTFOUND, ECONNREFUSED...) is on `cause`. */
function describeNetworkError(e: unknown): string {
    if (!(e instanceof Error)) return 'unknown error';
    const cause = (e as Error & { cause?: unknown }).cause;
    if (isRecord(cause) && typeof cause.code === 'string') return cause.code;
    if (cause instanceof Error && cause.message) return cause.message;
    return e.message || 'unknown error';
}
