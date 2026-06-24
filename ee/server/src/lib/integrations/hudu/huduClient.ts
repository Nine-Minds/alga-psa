/**
 * Hudu API Client
 *
 * A TypeScript client for the Hudu REST API v1 (pull-only, Phase 1). Hudu auth is
 * `x-api-key` header + per-instance base URL (NOT OAuth) — simpler than NinjaOne;
 * there is no token refresh. Mirrors the axios-client + factory style of
 * ninjaOneClient.ts but adds Hudu-specific page pagination (fixed 25/page),
 * 429/5xx backoff, and typed error mapping into a discriminated result type.
 *
 * SECURITY: the api key and any password value are never logged and are redacted
 * from every error surfaced by this client. List payloads carry metadata only.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as net from 'node:net';
import logger from '@alga-psa/core/logger';
import { resolveHuduCredentials, HuduCredentials } from './secrets';
import type {
  HuduResource,
  HuduCompany,
  HuduAsset,
  HuduAssetLayout,
  HuduAssetLayoutDetail,
  HuduArticle,
  HuduAssetPassword,
} from './contracts';

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const HUDU_PAGE_SIZE = 25; // Hudu pages are a fixed 25 items.

export interface HuduRetryOptions {
  /** Total attempts per request, including the first. */
  maxAttempts: number;
  /** Base delay (ms) for exponential backoff when no Retry-After is present. */
  baseDelayMs: number;
  /** Cap on any single backoff delay (ms). */
  maxDelayMs: number;
  /** Random jitter (ms) added on top of every backoff delay. */
  maxJitterMs: number;
}

/** Defaults for rate-limit / transient-error backoff. Overridable for tests. */
export const DEFAULT_RETRY_OPTIONS: HuduRetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  maxJitterMs: 250,
};

/**
 * Domain resource name -> Hudu API resource name. Callers use the domain name;
 * the client hits the real endpoint. Covers the UI-label naming traps.
 */
export const HUDU_RESOURCE_MAP = {
  companies: 'companies',
  assets: 'assets',
  articles: 'articles',
  passwords: 'asset_passwords',
  processes: 'procedures',
} as const;

export type HuduDomainResource = keyof typeof HUDU_RESOURCE_MAP;

/** Resolve a domain resource name to its Hudu API resource name. */
export function mapHuduResource(resource: HuduDomainResource | HuduResource): string {
  if (resource in HUDU_RESOURCE_MAP) {
    return HUDU_RESOURCE_MAP[resource as HuduDomainResource];
  }
  // Already an API resource name (companies/assets/articles/asset_passwords).
  return resource;
}

/** Discriminated typed result for a Hudu call. */
export type HuduErrorKind =
  | 'invalid_key' // 401
  | 'no_password_access' // 403
  | 'not_found' // 404
  | 'validation' // 422
  | 'rate_limited' // 429 (after retries exhausted)
  | 'server_error' // 5xx (after retries exhausted)
  | 'network_error' // no response (timeout/DNS/etc.)
  | 'unknown';

export interface HuduError {
  kind: HuduErrorKind;
  /** HTTP status when one was received. */
  status?: number;
  /** Redacted, human-readable summary. Never contains the key or a password. */
  message: string;
}

export type HuduResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: HuduError };

export class HuduRequestError extends Error {
  readonly hudu: HuduError;
  constructor(error: HuduError) {
    super(error.message);
    this.name = 'HuduRequestError';
    this.hudu = error;
  }
}

export interface HuduClientConfig {
  tenantId?: string;
  credentials: HuduCredentials;
  retryOptions?: Partial<HuduRetryOptions>;
  /** Injectable sleep — tests pass a no-op to keep backoff instant. */
  sleep?: (ms: number) => Promise<void>;
}

export interface HuduValidationResult {
  ok: boolean;
  /** True when the key can read companies. */
  connected: boolean;
  /** True when the key also has password (asset_passwords) access. */
  passwordAccess: boolean;
  /** Present when the connection itself failed (not when only passwords are denied). */
  error?: HuduError;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class HuduClient {
  private readonly tenantId?: string;
  private readonly axiosInstance: AxiosInstance;
  private readonly apiKey: string;
  private readonly retryOptions: HuduRetryOptions;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: HuduClientConfig) {
    this.tenantId = config.tenantId;
    this.apiKey = config.credentials.apiKey;
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...config.retryOptions };
    this.sleep = config.sleep ?? defaultSleep;

    this.axiosInstance = axios.create({
      baseURL: buildHuduApiBaseUrl(config.credentials.baseUrl),
      timeout: DEFAULT_TIMEOUT,
      headers: {
        'x-api-key': config.credentials.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  // ============ Collection fetches (paginated) ============

  async getCompanies(params: Record<string, string | number> = {}): Promise<HuduCompany[]> {
    return this.fetchAllPages<HuduCompany>('companies', 'companies', params);
  }

  async getAssets(companyId: number, params: Record<string, string | number> = {}): Promise<HuduAsset[]> {
    return this.fetchAllPages<HuduAsset>('assets', 'assets', { company_id: companyId, ...params });
  }

  async getArticles(companyId: number, params: Record<string, string | number> = {}): Promise<HuduArticle[]> {
    return this.fetchAllPages<HuduArticle>('articles', 'articles', { company_id: companyId, ...params });
  }

  async getAssetPasswords(
    companyId: number,
    params: Record<string, string | number> = {}
  ): Promise<HuduAssetPassword[]> {
    return this.fetchAllPages<HuduAssetPassword>('passwords', 'asset_passwords', {
      company_id: companyId,
      ...params,
    });
  }

  /** Single asset_password reveal (plaintext). Caller must never persist/log the value. */
  async getAssetPassword(id: number): Promise<HuduAssetPassword> {
    const data = await this.request<{ asset_password: HuduAssetPassword }>(
      'get',
      `/asset_passwords/${id}`
    );
    return data.asset_password;
  }

  /** Asset layouts as minimal {id, name} reference entries (single request). */
  async listAssetLayouts(): Promise<HuduAssetLayout[]> {
    const data = await this.request<{ asset_layouts: HuduAssetLayout[] }>('get', '/asset_layouts');
    const layouts = Array.isArray(data?.asset_layouts) ? data.asset_layouts : [];
    return layouts.map((layout) => ({ id: layout.id, name: layout.name }));
  }

  /** One asset layout WITH its field definitions (F316 create-type source). */
  async getAssetLayout(id: number): Promise<HuduAssetLayoutDetail> {
    const data = await this.request<{ asset_layout: HuduAssetLayoutDetail }>(
      'get',
      `/asset_layouts/${id}`
    );
    return data.asset_layout;
  }

  /**
   * One global page of articles (no company_id). `search` does case-insensitive
   * partial name matching on the Hudu side (`name` is exact-only); omitted when empty.
   * Never loops pages — callers paginate.
   */
  async listAllArticles({ page = 1, search }: { page?: number; search?: string } = {}): Promise<HuduArticle[]> {
    const params: Record<string, string | number> = { page };
    const term = search?.trim();
    if (term) params.search = term;

    const data = await this.request<{ articles: HuduArticle[] }>('get', '/articles', params);
    return Array.isArray(data?.articles) ? data.articles : [];
  }

  /**
   * Fetch every page of a collection. Hudu pages are a fixed 25 items; a page
   * returning < 25 items (or empty) is the last page. The collection is keyed by
   * the plural resource name in the response body.
   */
  async fetchAllPages<T>(
    domainResource: HuduDomainResource,
    responseKey: string,
    params: Record<string, string | number> = {}
  ): Promise<T[]> {
    const endpoint = `/${mapHuduResource(domainResource)}`;
    const items: T[] = [];
    let page = 1;

    // Guard against a misbehaving API that always returns full pages.
    const maxPages = 10000;

    while (page <= maxPages) {
      const body = await this.request<Record<string, unknown>>('get', endpoint, {
        ...params,
        page,
      });

      const pageItems = (Array.isArray(body?.[responseKey]) ? body[responseKey] : []) as T[];
      items.push(...pageItems);

      // Empty page or a short page is terminal.
      if (pageItems.length < HUDU_PAGE_SIZE) {
        break;
      }
      page += 1;
    }

    return items;
  }

  /**
   * Validate the connection: GET /companies?page=1 must succeed, and probe
   * /asset_passwords?page=1 to detect password-access capability. A 403 on the
   * probe means the key lacks password access (not an error) — passwordAccess=false.
   */
  async validateConnection(): Promise<HuduValidationResult> {
    try {
      await this.request<Record<string, unknown>>('get', '/companies', { page: 1 });
    } catch (error) {
      const huduError = error instanceof HuduRequestError ? error.hudu : toHuduError(error);
      return { ok: false, connected: false, passwordAccess: false, error: huduError };
    }

    let passwordAccess = false;
    try {
      await this.request<Record<string, unknown>>('get', '/asset_passwords', { page: 1 });
      passwordAccess = true;
    } catch (error) {
      const huduError = error instanceof HuduRequestError ? error.hudu : toHuduError(error);
      // 403 => key simply lacks password access; surface ok with the capability off.
      if (huduError.kind !== 'no_password_access') {
        // Any other failure on the probe is non-fatal for "connected"; log redacted.
        logger.warn('[HuduClient] asset_passwords probe failed', this.redactLog(huduError));
      }
      passwordAccess = false;
    }

    return { ok: true, connected: true, passwordAccess };
  }

  /**
   * Core request with rate-limit/transient retry and typed error mapping.
   * Throws HuduRequestError (carrying a redacted HuduError) on failure.
   */
  private async request<T>(
    method: 'get',
    url: string,
    params?: Record<string, string | number>
  ): Promise<T> {
    let attempt = 0;

    for (;;) {
      attempt += 1;
      try {
        const response = await this.axiosInstance.request<T>({ method, url, params });
        return response.data;
      } catch (error) {
        const huduError = toHuduError(error);
        const status = huduError.status;
        const retryable = status === 429 || (status !== undefined && status >= 500);

        if (retryable && attempt < this.retryOptions.maxAttempts) {
          const delay = this.computeBackoffDelay(error, attempt, status);
          logger.warn('[HuduClient] retrying after retryable error', {
            ...this.redactLog(huduError),
            attempt,
            delayMs: delay,
          });
          await this.sleep(delay);
          continue;
        }

        logger.error('[HuduClient] request failed', this.redactLog(huduError));
        throw new HuduRequestError(huduError);
      }
    }
  }

  /**
   * Backoff delay (ms): on 429 honor Retry-After (seconds) when present, else
   * exponential backoff on attempt count; always add jitter and cap the result.
   */
  private computeBackoffDelay(error: unknown, attempt: number, status?: number): number {
    let base: number;

    const retryAfterMs = status === 429 ? parseRetryAfter(error) : undefined;
    if (retryAfterMs !== undefined) {
      base = retryAfterMs;
    } else {
      // Exponential: baseDelay * 2^(attempt-1).
      base = this.retryOptions.baseDelayMs * 2 ** (attempt - 1);
    }

    const jitter = Math.floor(Math.random() * (this.retryOptions.maxJitterMs + 1));
    return Math.min(base + jitter, this.retryOptions.maxDelayMs);
  }

  /** Build a log-safe object that can never contain the api key. */
  private redactLog(error: HuduError): Record<string, unknown> {
    return {
      tenantId: this.tenantId,
      kind: error.kind,
      status: error.status,
      message: redactSecret(error.message, this.apiKey),
    };
  }
}

/**
 * Map any thrown value into a typed, redacted HuduError. Never includes the api
 * key, request headers, or response bodies (which could carry a password value).
 */
export function toHuduError(error: unknown): HuduError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;

    if (status === undefined) {
      // No response: timeout / DNS / connection reset.
      return {
        kind: 'network_error',
        message: `Hudu request failed: ${error.code ?? error.message ?? 'network error'}`,
      };
    }

    return { kind: classifyStatus(status), status, message: messageForStatus(status) };
  }

  if (error instanceof Error) {
    return { kind: 'unknown', message: error.message };
  }

  return { kind: 'unknown', message: 'Unknown Hudu client error' };
}

function classifyStatus(status: number): HuduErrorKind {
  switch (status) {
    case 401:
      return 'invalid_key';
    case 403:
      return 'no_password_access';
    case 404:
      return 'not_found';
    case 422:
      return 'validation';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server_error' : 'unknown';
  }
}

function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Hudu rejected the API key (401). Verify the key and base URL.';
    case 403:
      return 'Hudu API key lacks password access (403).';
    case 404:
      return 'Hudu resource not found (404). Verify the base URL or id.';
    case 422:
      return 'Hudu rejected the request (422 validation).';
    case 429:
      return 'Hudu rate limit exceeded (429).';
    default:
      return status >= 500
        ? `Hudu server error (${status}).`
        : `Hudu request failed (${status}).`;
  }
}

/** Parse a Retry-After header (seconds) from an axios error into ms. */
function parseRetryAfter(error: unknown): number | undefined {
  if (!axios.isAxiosError(error)) return undefined;
  const header = (error as AxiosError).response?.headers?.['retry-after'];
  if (header === undefined || header === null) return undefined;
  const seconds = Number(Array.isArray(header) ? header[0] : header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.floor(seconds * 1000);
}

/** Remove any occurrence of the secret from a string. */
export function redactSecret(value: string, secret?: string): string {
  if (!secret || secret.length === 0) return value;
  return value.split(secret).join('[REDACTED]');
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (net.isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (net.isIP(normalized) === 6) {
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80')
    );
  }
  return false;
}

/** Normalize a base URL to `<instance>/api/v1` (idempotent). */
export function buildHuduApiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(?:\/v1)?$/, '')
    .concat('/api/v1');
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:') {
    throw new Error('Hudu base URL must use HTTPS.');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('Hudu base URL must not target localhost or private network addresses.');
  }
  return normalized;
}

/**
 * Factory: build a HuduClient for a tenant by resolving stored credentials
 * (tenant secret -> env fallback). Mirrors createNinjaOneClient.
 */
export async function createHuduClient(
  tenantId?: string,
  options?: { retryOptions?: Partial<HuduRetryOptions>; sleep?: (ms: number) => Promise<void> }
): Promise<HuduClient> {
  const credentials = await resolveHuduCredentials(tenantId);
  return new HuduClient({ tenantId, credentials, ...options });
}
