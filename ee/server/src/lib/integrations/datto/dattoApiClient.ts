import axios, { AxiosError, AxiosInstance } from 'axios';

import { DATTO_RMM_PLATFORMS, dattoPlatformApiUrl, type DattoRmmPlatform } from './shared';
import type {
  DattoAccount,
  DattoAlert,
  DattoComponent,
  DattoCreateQuickJobResponse,
  DattoDevice,
  DattoDeviceAudit,
  DattoEsxiHostAudit,
  DattoJob,
  DattoJobResults,
  DattoJobStdData,
  DattoPrinterAudit,
  DattoRequestRate,
  DattoSite,
  DattoSoftware,
} from './types';

export const DATTO_PAGE_SIZE = 250;
const PAGE_SIZE = DATTO_PAGE_SIZE;
const DEFAULT_MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 30_000;
// Datto tokens live about 100 hours; used when the token response omits expires_in.
const DEFAULT_TOKEN_TTL_SECONDS = 100 * 60 * 60;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Extra attempts for a GET that hit a gateway error or dropped connection.
const MAX_TRANSIENT_RETRIES = 2;
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'EAI_AGAIN']);
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const RETRY_AFTER_MAX_MS = 120_000;
// In-flight requests allowed per credential in this process (all client instances).
const MAX_CONCURRENT_REQUESTS = 6;
// Guards against a nextPageUrl loop; 250 * 10_000 is far beyond any real account.
const MAX_PAGES = 10_000;

// Datto's public OAuth client for the password grant; not a secret.
const TOKEN_CLIENT_AUTH = `Basic ${Buffer.from('public-client:public').toString('base64')}`;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

// The bearer token and API secret are sent to whatever host is configured, so
// only Datto's own API hosts are accepted. Loopback is a test-only allowance.
const ALLOWED_DATTO_HOST_SUFFIXES = ['.centrastage.net', '.rmm.datto.com'];

function allowLocalDattoHosts(): boolean {
  return process.env.NODE_ENV === 'test';
}

export function isAllowedDattoHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase();
  if (!host) return false;
  if (allowLocalDattoHosts() && LOCAL_HOSTNAMES.has(host)) return true;
  return ALLOWED_DATTO_HOST_SUFFIXES.some((suffix) => host.length > suffix.length && host.endsWith(suffix));
}

/**
 * Throws unless `baseUrl` is an https URL on a Datto API host
 * (`*.centrastage.net` / `*.rmm.datto.com`) with no explicit port. Run on save,
 * when building a client from stored settings, and by the client itself, so a
 * tampered or stale custom URL can never receive credentials.
 */
export function assertAllowedDattoBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Datto RMM API URL is not a valid URL');
  }
  const local = allowLocalDattoHosts() && LOCAL_HOSTNAMES.has(url.hostname);
  if (!isAllowedDattoHost(url.hostname) || (!local && (url.protocol !== 'https:' || url.port))) {
    throw new Error('Datto RMM API URL must be an https URL on a Datto host (*.centrastage.net or *.rmm.datto.com)');
  }
}

/**
 * Accepts a platform name ('merlot'), a host ('merlot-api.centrastage.net'), or
 * a full URL with or without a trailing `/api` or slashes, and returns
 * `https://<host>/api`. Plain http is only allowed for localhost (tests).
 */
export function normalizeDattoBaseUrl(input: string): string {
  const raw = (input || '').trim();
  if (!raw) throw new Error('Datto RMM API URL is not configured');

  const lowered = raw.toLowerCase();
  if ((DATTO_RMM_PLATFORMS as readonly string[]).includes(lowered)) {
    return dattoPlatformApiUrl(lowered as DattoRmmPlatform);
  }

  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new Error('Datto RMM API URL is not a valid URL');
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname))) {
    throw new Error('Datto RMM API URL must use https');
  }
  if (!url.hostname) throw new Error('Datto RMM API URL is not a valid URL');

  const pathname = url.pathname.replace(/\/+$/, '');
  const normalizedPath = /\/api$/i.test(pathname) ? pathname : `${pathname}/api`;
  return `${url.protocol}//${url.host}${normalizedPath}`;
}

export class DattoRmmAuthError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, details: { status: number; path: string }) {
    super(message);
    this.name = 'DattoRmmAuthError';
    this.status = details.status;
    this.path = details.path;
  }
}

/**
 * The integration is flagged reconnect-required, so interactive actions refuse
 * to retry credentials already known to be bad. The message is written for the UI.
 */
export class DattoRmmReconnectRequiredError extends Error {
  constructor(reason?: string | null) {
    super(`Datto RMM needs to be reconnected: ${reason || 'the stored API credentials were rejected.'}`);
    this.name = 'DattoRmmReconnectRequiredError';
  }
}

/**
 * Datto is rate limiting this credential and the wait would exceed the
 * client's `maxRetryAfterMs` budget. Callers in request handlers fall back
 * rather than sleep.
 */
export class DattoRmmRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('Datto RMM is rate limiting requests for this account. Try again shortly.');
    this.name = 'DattoRmmRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class DattoRmmPermissionError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, details: { status: number; path: string }) {
    super(message);
    this.name = 'DattoRmmPermissionError';
    this.status = details.status;
    this.path = details.path;
  }
}

export interface DattoTokenStore {
  get(): Promise<{ token: string; expiresAt: number } | null>;
  set(token: string, expiresAt: number): Promise<void>;
  clear?(): Promise<void>;
}

// Shared by every client instance in this process that uses the same
// credential, so concurrent jobs (alert poll, device sync, webhooks) neither
// exceed Datto's request budget together nor each rediscover a 429 on their own.
interface RateLimiter {
  inFlight: number;
  waiters: Array<() => void>;
  /** Epoch ms until which every request for this credential should hold off. */
  blockedUntil: number;
}

const rateLimiters = new Map<string, RateLimiter>();

function limiterFor(key: string): RateLimiter {
  let limiter = rateLimiters.get(key);
  if (!limiter) {
    limiter = { inFlight: 0, waiters: [], blockedUntil: 0 };
    rateLimiters.set(key, limiter);
  }
  return limiter;
}

async function acquireSlot(limiter: RateLimiter): Promise<() => void> {
  if (limiter.inFlight < MAX_CONCURRENT_REQUESTS) {
    limiter.inFlight += 1;
  } else {
    // The releasing request hands its slot straight to us (inFlight unchanged).
    await new Promise<void>((resolve) => limiter.waiters.push(resolve));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = limiter.waiters.shift();
    if (next) next();
    else limiter.inFlight -= 1;
  };
}

/** Test hook: forget all per-credential limiter state. */
export function resetDattoRateLimiters(): void {
  rateLimiters.clear();
}

function statusOf(err: unknown): number | undefined {
  return (err as AxiosError | undefined)?.response?.status;
}

/** No HTTP response at all: the connection dropped or timed out. */
function isTransientNetworkError(err: unknown): boolean {
  if (statusOf(err) !== undefined) return false;
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code);
}

function headerOf(err: unknown, name: string): string | undefined {
  const headers: any = (err as AxiosError | undefined)?.response?.headers;
  if (!headers) return undefined;
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
  return value == null ? undefined : String(value);
}

// Axios errors carry the request config, whose headers hold the bearer token
// (and, for the token call, the API secret in the body). Keep only what is
// useful for diagnosis so nothing downstream can log a credential.
function scrubAxiosError<E>(err: E): E {
  if (!axios.isAxiosError(err)) return err;
  const ax = err as AxiosError;
  const summary = { method: ax.config?.method, url: ax.config?.url } as any;
  ax.config = summary;
  (ax as any).request = undefined;
  if (ax.response) {
    (ax.response as any).config = summary;
    (ax.response as any).request = undefined;
  }
  return err;
}

function retryDelayMs(err: unknown, attempt: number): number {
  const retryAfter = headerOf(err, 'retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), RETRY_AFTER_MAX_MS);
  }
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

export class DattoRmmClient {
  private readonly baseUrl: string;
  private readonly http: AxiosInstance;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private token: { token: string; expiresAt: number } | null = null;
  private tokenLoaded = false;
  private tokenPromise: Promise<string> | null = null;

  /** Every HTTP request made by this client, including token fetches and retries. */
  requestCount = 0;

  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string;
      apiSecret: string;
      tokenStore?: DattoTokenStore;
      http?: AxiosInstance;
      sleep?: (ms: number) => Promise<void>;
      maxRetries?: number;
      /**
       * Most time a single request may spend waiting out rate limits (a pause
       * after a 429, in total). A wait beyond it throws DattoRmmRateLimitError
       * instead of sleeping, so request handlers never block for minutes.
       * Unset: honor Retry-After up to two minutes per wait.
       */
      maxRetryAfterMs?: number;
      /** Called when the token endpoint rejects the API key and secret. */
      onAuthFailure?: (err: DattoRmmAuthError) => Promise<void> | void;
      /** Called after a token was obtained from the credentials. */
      onAuthSuccess?: () => Promise<void> | void;
    }
  ) {
    this.baseUrl = normalizeDattoBaseUrl(opts.baseUrl);
    assertAllowedDattoBaseUrl(this.baseUrl);
    // No redirects: a 3xx must never carry the bearer token to another host.
    this.http = opts.http ?? axios.create({ timeout: REQUEST_TIMEOUT_MS, maxRedirects: 0 });
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private async getToken(): Promise<string> {
    if (!this.tokenLoaded) {
      this.tokenLoaded = true;
      try {
        this.token = (await this.opts.tokenStore?.get()) ?? null;
      } catch {
        // A broken store only costs one extra token fetch.
        this.token = null;
      }
    }

    if (this.token && Date.now() < this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.token.token;
    }

    // One in-flight fetch shared by concurrent callers (device sync fans out).
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  private limiter(): RateLimiter {
    return limiterFor(`${this.baseUrl}\n${this.opts.apiKey}`);
  }

  /** One HTTP call through the per-credential concurrency cap. */
  private async dispatch<R>(config: Parameters<AxiosInstance['request']>[0]): Promise<{ data: R }> {
    const release = await acquireSlot(this.limiter());
    try {
      return await this.http.request<R>(config);
    } finally {
      release();
    }
  }

  /**
   * Holds the request while another request for this credential is inside a
   * 429 window. Each distinct window is waited out once per request; a wait
   * that does not fit the request's budget throws instead of sleeping.
   */
  private async waitForRateLimitWindow(budget: { remaining: number }, seen: { until: number }): Promise<void> {
    const until = this.limiter().blockedUntil;
    const wait = until - Date.now();
    if (wait <= 0 || until === seen.until) return;
    seen.until = until;
    if (wait > budget.remaining) throw new DattoRmmRateLimitError(wait);
    budget.remaining -= wait;
    await this.sleep(wait);
  }

  /**
   * Another process may have refreshed the shared token while ours was failing.
   * A different, still-valid stored token is worth one attempt before we
   * re-authenticate (and clear the store) ourselves.
   */
  private async readFresherStoredToken(failedToken: string): Promise<{ token: string; expiresAt: number } | null> {
    try {
      const stored = await this.opts.tokenStore?.get();
      if (stored && stored.token !== failedToken && Date.now() < stored.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
        return stored;
      }
    } catch {
      // A broken store just means we re-authenticate.
    }
    return null;
  }

  /**
   * Drops `failedToken` only. A concurrent request may already have fetched a
   * fresh one (here or in another process via the store); wiping that would
   * just force another token fetch.
   */
  private async invalidateToken(failedToken: string): Promise<void> {
    if (this.token?.token === failedToken) this.token = null;
    const store = this.opts.tokenStore;
    if (!store?.clear) return;
    try {
      const stored = await store.get();
      if (stored && stored.token !== failedToken) return;
      await store.clear();
    } catch {
      // Best-effort; the next fetch overwrites it.
    }
  }

  private async fetchToken(): Promise<string> {
    const path = '/auth/oauth/token';
    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.opts.apiKey,
      password: this.opts.apiSecret,
    }).toString();

    this.requestCount += 1;
    let data: any;
    try {
      const res = await this.dispatch<{ access_token?: string; expires_in?: number }>({
        method: 'POST',
        url: `${this.authBaseUrl()}${path}`,
        headers: {
          Authorization: TOKEN_CLIENT_AUTH,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        data: body,
      });
      data = res.data;
    } catch (err) {
      const status = statusOf(err);
      if (status === 400 || status === 401) {
        const authError = new DattoRmmAuthError(
          'Datto RMM rejected the API key and secret. Check the credentials and platform, then reconnect the integration.',
          { status, path }
        );
        await this.opts.onAuthFailure?.(authError);
        throw authError;
      }
      throw scrubAxiosError(err);
    }

    const accessToken = typeof data?.access_token === 'string' ? data.access_token : '';
    if (!accessToken) {
      throw new DattoRmmAuthError('Datto RMM did not return an access token.', { status: 200, path });
    }

    const expiresIn = Number(data?.expires_in);
    const ttlSeconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_TOKEN_TTL_SECONDS;
    const expiresAt = Date.now() + ttlSeconds * 1000;

    this.token = { token: accessToken, expiresAt };
    try {
      await this.opts.tokenStore?.set(accessToken, expiresAt);
    } catch {
      // The in-memory copy still works for this client's lifetime.
    }
    await this.opts.onAuthSuccess?.();
    return accessToken;
  }

  // The token endpoint lives at the host root (/auth/oauth/token), outside the
  // /api prefix the data endpoints share; /api/auth/oauth/token returns 403.
  private authBaseUrl(): string {
    return this.baseUrl.replace(/\/api$/i, '');
  }

  private resolveUrl(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private async send<T>(args: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    path: string;
    params?: Record<string, any>;
    data?: any;
  }): Promise<T> {
    let triedStoredToken = false;
    let reauthed = false;
    let rateLimitRetries = 0;
    let transientRetries = 0;
    const budget = { remaining: this.opts.maxRetryAfterMs ?? Number.POSITIVE_INFINITY };
    const seenWindow = { until: 0 };

    for (;;) {
      await this.waitForRateLimitWindow(budget, seenWindow);
      const token = await this.getToken();

      this.requestCount += 1;
      try {
        const res = await this.dispatch<T>({
          method: args.method,
          url: args.url,
          params: args.params,
          data: args.data,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        return res.data;
      } catch (err) {
        const status = statusOf(err);

        if (status === 401) {
          if (!triedStoredToken) {
            triedStoredToken = true;
            const fresher = await this.readFresherStoredToken(token);
            if (fresher) {
              this.token = fresher;
              continue;
            }
          }
          if (!reauthed) {
            // The token may have been revoked or rotated; re-auth once and retry once.
            reauthed = true;
            await this.invalidateToken(token);
            continue;
          }
          // The token endpoint just accepted our credentials, so this is a
          // resource-level 401, not a dead credential: do not flag the
          // integration reconnect-required (fetchToken does that on a 400/401
          // from the token endpoint itself).
          throw new DattoRmmAuthError(
            'Datto RMM rejected the access token after re-authenticating. Try again, or reconnect the integration if it keeps happening.',
            { status, path: args.path }
          );
        }

        if (status === 403) {
          throw new DattoRmmPermissionError(
            `Datto RMM denied access to ${args.path}. The Datto API user's security level does not have access to this resource.`,
            { status, path: args.path }
          );
        }

        if (status === 429 && rateLimitRetries < this.maxRetries) {
          const delay = retryDelayMs(err, rateLimitRetries);
          rateLimitRetries += 1;
          // Everyone using this credential holds off until the window passes.
          const limiter = this.limiter();
          limiter.blockedUntil = Math.max(limiter.blockedUntil, Date.now() + delay);
          if (delay > budget.remaining) throw new DattoRmmRateLimitError(delay);
          budget.remaining -= delay;
          seenWindow.until = limiter.blockedUntil;
          await this.sleep(delay);
          continue;
        }

        // Only GETs are retried: a PUT/POST (quick job, resolve) that reached
        // Datto before the connection dropped would run twice.
        if (
          args.method === 'GET'
          && transientRetries < Math.min(MAX_TRANSIENT_RETRIES, this.maxRetries)
          && ((status !== undefined && TRANSIENT_STATUSES.has(status)) || isTransientNetworkError(err))
        ) {
          const delay = retryDelayMs(err, transientRetries);
          // Not a rate limit, so no shared window; a wait that does not fit the budget just surfaces the error.
          if (delay <= budget.remaining) {
            transientRetries += 1;
            budget.remaining -= delay;
            await this.sleep(delay);
            continue;
          }
        }

        throw scrubAxiosError(err);
      }
    }
  }

  async request<T>(args: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    params?: Record<string, any>;
    data?: any;
  }): Promise<T> {
    return this.send<T>({ ...args, url: this.resolveUrl(args.path) });
  }

  // Datto hands back absolute nextPageUrl values. Only follow them on our own
  // origin so a bad response cannot make us send the bearer token elsewhere.
  private resolveNextPageUrl(next: string): { url: string; path: string } {
    const base = new URL(this.baseUrl);
    let target: URL;
    try {
      target = new URL(next, `${base.origin}/`);
    } catch {
      throw new Error('Datto RMM returned an invalid pagination URL');
    }
    if (target.origin !== base.origin) {
      throw new Error('Datto RMM returned a pagination URL on a different host');
    }
    return { url: target.toString(), path: target.pathname };
  }

  /** Yields one array of items per page, following pageDetails.nextPageUrl until it is absent. */
  async *paginate<T>(path: string, itemsKey: string, params?: Record<string, any>): AsyncGenerator<T[], void, undefined> {
    let page = await this.request<any>({ method: 'GET', path, params: { ...(params || {}), max: PAGE_SIZE } });
    const seen = new Set<string>();

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum += 1) {
      const items = page?.[itemsKey];
      yield Array.isArray(items) ? (items as T[]) : [];

      const next = page?.pageDetails?.nextPageUrl;
      if (!next || typeof next !== 'string') return;

      const target = this.resolveNextPageUrl(next);
      // A truncated list must never look complete: reconciliation treats the
      // open-alert list as authoritative and closes tickets for anything missing.
      if (seen.has(target.url)) {
        throw new Error(`Datto RMM pagination for ${path} repeated a page URL; the list may be incomplete.`);
      }
      seen.add(target.url);

      page = await this.send<any>({ method: 'GET', url: target.url, path: target.path });
    }
    throw new Error(`Datto RMM pagination for ${path} exceeded ${MAX_PAGES} pages; the list may be incomplete.`);
  }

  async listAll<T>(path: string, itemsKey: string, params?: Record<string, any>): Promise<T[]> {
    const all: T[] = [];
    for await (const items of this.paginate<T>(path, itemsKey, params)) {
      all.push(...items);
    }
    return all;
  }

  async getAccount(): Promise<DattoAccount> {
    return this.request<DattoAccount>({ method: 'GET', path: '/v2/account' });
  }

  async listSites(): Promise<DattoSite[]> {
    return this.listAll<DattoSite>('/v2/account/sites', 'sites');
  }

  async getSite(siteUid: string): Promise<DattoSite> {
    return this.request<DattoSite>({ method: 'GET', path: `/v2/site/${encodeURIComponent(siteUid)}` });
  }

  pageSiteDevices(siteUid: string): AsyncGenerator<DattoDevice[], void, undefined> {
    return this.paginate<DattoDevice>(`/v2/site/${encodeURIComponent(siteUid)}/devices`, 'devices');
  }

  /**
   * Every device in the account, each carrying its siteUid. One walk costs
   * ceil(devices / 250) calls however many sites there are, which beats the
   * per-site walk once an account has more sites than full pages.
   */
  pageAccountDevices(): AsyncGenerator<DattoDevice[], void, undefined> {
    return this.paginate<DattoDevice>('/v2/account/devices', 'devices');
  }

  async listSiteDevices(siteUid: string): Promise<DattoDevice[]> {
    return this.listAll<DattoDevice>(`/v2/site/${encodeURIComponent(siteUid)}/devices`, 'devices');
  }

  async getDevice(deviceUid: string): Promise<DattoDevice> {
    return this.request<DattoDevice>({ method: 'GET', path: `/v2/device/${encodeURIComponent(deviceUid)}` });
  }

  async getDeviceAudit(deviceUid: string): Promise<DattoDeviceAudit> {
    return this.request<DattoDeviceAudit>({ method: 'GET', path: `/v2/audit/device/${encodeURIComponent(deviceUid)}` });
  }

  async getPrinterAudit(deviceUid: string): Promise<DattoPrinterAudit> {
    return this.request<DattoPrinterAudit>({ method: 'GET', path: `/v2/audit/printer/${encodeURIComponent(deviceUid)}` });
  }

  async getEsxiHostAudit(deviceUid: string): Promise<DattoEsxiHostAudit> {
    return this.request<DattoEsxiHostAudit>({ method: 'GET', path: `/v2/audit/esxihost/${encodeURIComponent(deviceUid)}` });
  }

  async listDeviceSoftware(deviceUid: string): Promise<DattoSoftware[]> {
    return this.listAll<DattoSoftware>(`/v2/audit/device/${encodeURIComponent(deviceUid)}/software`, 'software');
  }

  async listOpenAlerts(): Promise<DattoAlert[]> {
    return this.listAll<DattoAlert>('/v2/account/alerts/open', 'alerts');
  }

  async listSiteOpenAlerts(siteUid: string): Promise<DattoAlert[]> {
    return this.listAll<DattoAlert>(`/v2/site/${encodeURIComponent(siteUid)}/alerts/open`, 'alerts');
  }

  async getAlert(alertUid: string): Promise<DattoAlert> {
    return this.request<DattoAlert>({ method: 'GET', path: `/v2/alert/${encodeURIComponent(alertUid)}` });
  }

  async resolveAlert(alertUid: string): Promise<void> {
    await this.request<unknown>({ method: 'POST', path: `/v2/alert/${encodeURIComponent(alertUid)}/resolve` });
  }

  async createQuickJob(
    deviceUid: string,
    args: { jobName: string; componentUid: string; variables?: Array<{ name: string; value: string }> }
  ): Promise<DattoCreateQuickJobResponse> {
    return this.request<DattoCreateQuickJobResponse>({
      method: 'PUT',
      path: `/v2/device/${encodeURIComponent(deviceUid)}/quickjob`,
      data: {
        jobName: args.jobName,
        jobComponent: {
          componentUid: args.componentUid,
          variables: args.variables ?? [],
        },
      },
    });
  }

  async getJob(jobUid: string): Promise<DattoJob> {
    return this.request<DattoJob>({ method: 'GET', path: `/v2/job/${encodeURIComponent(jobUid)}` });
  }

  async getJobResults(jobUid: string, deviceUid: string): Promise<DattoJobResults> {
    return this.request<DattoJobResults>({
      method: 'GET',
      path: `/v2/job/${encodeURIComponent(jobUid)}/results/${encodeURIComponent(deviceUid)}`,
    });
  }

  async getJobStdout(jobUid: string, deviceUid: string): Promise<DattoJobStdData[]> {
    return this.request<DattoJobStdData[]>({
      method: 'GET',
      path: `/v2/job/${encodeURIComponent(jobUid)}/results/${encodeURIComponent(deviceUid)}/stdout`,
    });
  }

  async getJobStderr(jobUid: string, deviceUid: string): Promise<DattoJobStdData[]> {
    return this.request<DattoJobStdData[]>({
      method: 'GET',
      path: `/v2/job/${encodeURIComponent(jobUid)}/results/${encodeURIComponent(deviceUid)}/stderr`,
    });
  }

  async listComponents(): Promise<DattoComponent[]> {
    return this.listAll<DattoComponent>('/v2/account/components', 'components');
  }

  async getRequestRate(): Promise<DattoRequestRate> {
    return this.request<DattoRequestRate>({ method: 'GET', path: '/v2/system/request_rate' });
  }
}
