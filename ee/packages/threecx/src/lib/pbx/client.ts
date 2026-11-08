import logger from '@alga-psa/core/logger';
import {
  getThreecxAccessToken,
  invalidateThreecxToken,
  resolveThreecxPbxCredentials,
  trimBaseUrl,
  type ThreecxFetch,
  type ThreecxPbxCredentials,
  type ThreecxTokenStore,
} from './token';

export const THREECX_XAPI_BASE = '/xapi/v1';
export const THREECX_CALL_CONTROL_BASE = '/callcontrol';

const BODY_EXCERPT_MAX = 500;

/**
 * Bounds a response body for errors and logs, and masks anything that looks
 * like a credential (bearer tokens, JWTs, secret/password/token fields).
 */
export function redactThreecxText(text: string, max = BODY_EXCERPT_MAX): string {
  const masked = (text ?? '')
    .replace(/(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted-jwt]')
    .replace(
      /(["']?(?:client_secret|clientSecret|secret|password|passwd|access_token|refresh_token|token|authorization|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,&}]+)/gi,
      '$1"[redacted]"',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return masked.length > max ? `${masked.slice(0, max)}…` : masked;
}

export class ThreecxPbxError extends Error {
  /** Bounded, credential-redacted excerpt of the PBX response body. */
  public readonly body: string;
  /** Set by the client: the role-gated capability the failing request belongs to. */
  public capability: string | null = null;
  constructor(
    message: string,
    public readonly status: number,
    body: string,
  ) {
    super(message);
    this.name = 'ThreecxPbxError';
    this.body = redactThreecxText(body);
  }
}

/** Which role-gated capability an XAPI path belongs to, for log correlation. */
export function threecxCapabilityForPath(path: string): string {
  if (/\/Users(\b|\(|\/|\?|$)/.test(path)) return 'users';
  if (/\/Contacts(\b|\(|\/|\?|$)/.test(path)) return 'contacts';
  if (path.startsWith(THREECX_CALL_CONTROL_BASE)) return 'callControl';
  return 'xapi';
}

export type ThreecxQuery = Record<string, string | number | boolean | undefined>;

export interface ThreecxPbxClient {
  baseUrl: string;
  xapiGet<T = unknown>(path: string, query?: ThreecxQuery): Promise<T>;
  xapiPost<T = unknown>(path: string, body?: unknown): Promise<T>;
  xapiPatch<T = unknown>(path: string, body?: unknown): Promise<T>;
  xapiDelete(path: string): Promise<void>;
  /** Raw bytes for a download endpoint under /xapi/v1. */
  xapiDownload(path: string): Promise<Uint8Array>;
  callControlGet<T = unknown>(path: string): Promise<T>;
  callControlPost<T = unknown>(path: string, body?: unknown): Promise<T>;
  /** A fresh bearer, for callers that open their own connection (WebSocket). */
  accessToken(force?: boolean): Promise<string>;
}

export interface CreateThreecxPbxClientOptions {
  credentials?: ThreecxPbxCredentials;
  fetchImpl?: ThreecxFetch;
  store?: ThreecxTokenStore;
  /** Capability probes expect refusals: log them at debug, the caller reports the verdict. */
  expectFailures?: boolean;
}

function buildQuery(query?: ThreecxQuery): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function joinPath(base: string, path: string): string {
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Thin HTTP wrapper around the two PBX surfaces. A 401 evicts the shared
 * token and retries once; a second 401 surfaces as ThreecxPbxError.
 */
export async function createThreecxPbxClient(
  tenantId: string,
  options: CreateThreecxPbxClientOptions = {},
): Promise<ThreecxPbxClient> {
  const credentials = options.credentials ?? (await resolveThreecxPbxCredentials(tenantId));
  if (!credentials) {
    throw new ThreecxPbxError('The PBX API credentials are not configured.', 0, '');
  }
  const baseUrl = trimBaseUrl(credentials.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenOptions = { credentials, fetchImpl: options.fetchImpl, store: options.store };

  function logFailure(method: string, path: string, failure: ThreecxPbxError): void {
    const log = options.expectFailures ? logger.debug : logger.error;
    log.call(logger, '[3CX] PBX request failed', {
      tenantId,
      method,
      // Paths carry no credentials; the query string is dropped to be safe.
      path: path.split('?')[0],
      capability: (failure.capability = threecxCapabilityForPath(path)),
      status: failure.status,
      bodyExcerpt: failure.body,
    });
  }

  async function request(
    method: string,
    path: string,
    body: unknown,
    accept: 'json' | 'bytes' | 'none',
  ): Promise<unknown> {
    let retried = false;
    for (;;) {
      const token = await getThreecxAccessToken(tenantId, { ...tokenOptions, force: retried });
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (accept === 'json') headers.accept = 'application/json';
      let init: RequestInit = { method, headers };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        init = { ...init, body: JSON.stringify(body) };
      }
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, init);
      } catch (error) {
        const failure = new ThreecxPbxError(
          `Could not reach the PBX: ${error instanceof Error ? error.message : String(error)}`,
          0,
          '',
        );
        logFailure(method, path, failure);
        throw failure;
      }
      if (response.status === 401 && !retried) {
        retried = true;
        await invalidateThreecxToken(tenantId, options.store);
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const failure = new ThreecxPbxError(
          `PBX ${method} ${path} failed (${response.status})${text ? `: ${redactThreecxText(text, 200)}` : ''}`,
          response.status,
          text,
        );
        logFailure(method, path, failure);
        throw failure;
      }
      if (accept === 'none') return undefined;
      if (accept === 'bytes') return new Uint8Array(await response.arrayBuffer());
      if (response.status === 204) return undefined;
      const text = await response.text();
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }

  return {
    baseUrl,
    xapiGet: (path, query) => request('GET', joinPath(THREECX_XAPI_BASE, path) + buildQuery(query), undefined, 'json') as any,
    xapiPost: (path, body) => request('POST', joinPath(THREECX_XAPI_BASE, path), body ?? {}, 'json') as any,
    xapiPatch: (path, body) => request('PATCH', joinPath(THREECX_XAPI_BASE, path), body ?? {}, 'json') as any,
    xapiDelete: (path) => request('DELETE', joinPath(THREECX_XAPI_BASE, path), undefined, 'none') as Promise<void>,
    xapiDownload: (path) => request('GET', joinPath(THREECX_XAPI_BASE, path), undefined, 'bytes') as Promise<Uint8Array>,
    callControlGet: (path) => request('GET', joinPath(THREECX_CALL_CONTROL_BASE, path), undefined, 'json') as any,
    callControlPost: (path, body) => request('POST', joinPath(THREECX_CALL_CONTROL_BASE, path), body ?? {}, 'json') as any,
    accessToken: (force) => getThreecxAccessToken(tenantId, { ...tokenOptions, force: Boolean(force) }),
  };
}

/** OData collections come back as `{ value: [...] }`; tolerate a bare array too. */
export function odataValues<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).value)) {
    return (payload as any).value as T[];
  }
  return [];
}

/** Pages an OData collection with $top/$skip until a short page. */
export async function odataPageAll<T>(
  client: ThreecxPbxClient,
  path: string,
  query: ThreecxQuery,
  pageSize = 200,
): Promise<T[]> {
  const all: T[] = [];
  let skip = 0;
  for (;;) {
    const page = odataValues<T>(await client.xapiGet(path, { ...query, $top: pageSize, $skip: skip }));
    all.push(...page);
    if (page.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}
