/**
 * UniFi API client covering both connection modes behind one interface.
 *
 * - `site_manager` (default): one Site Manager API key (`X-API-KEY`) against
 *   https://api.ui.com. Consoles come from `GET /v1/hosts`; per-console Network
 *   data (sites, devices) is read through the Cloud Connector proxy so nothing
 *   needs inbound access to the customer's site.
 * - `local`: a Network Integration API key against a controller the MSP can
 *   reach directly (`https://{console}/proxy/network/integration/v1`).
 *
 * ENDPOINT / FIELD ASSUMPTIONS LIVE IN THIS FILE (paths, pagination shapes,
 * field names in `parse*`) AND IN mappers/deviceMapper.ts. They are written
 * against the documented shapes but have NOT been verified against a live key
 * (plan §7.1) — correct them here first when the spike runs.
 *
 * Security: the API key is only ever placed in the `X-API-KEY` request header.
 * Every error message is passed through `redact()` and the key is never logged.
 */

import { getSecretProviderInstance } from '@alga-psa/core/secrets';

export const UNIFI_API_KEY_SECRET = 'unifi_api_key';
export const UNIFI_LOCAL_BASE_URL_SECRET = 'unifi_local_base_url';
export const UNIFI_CLOUD_BASE_URL = 'https://api.ui.com';
/** `hostId` used for every site in local mode (there is exactly one controller). */
export const UNIFI_LOCAL_HOST_ID = 'local';

export type UniFiConnectionMode = 'site_manager' | 'local';
export type UniFiApiErrorKind = 'auth' | 'rate_limited' | 'http' | 'network' | 'invalid_response' | 'config';

export class UniFiApiError extends Error {
  readonly status?: number;
  readonly kind: UniFiApiErrorKind;

  constructor(message: string, kind: UniFiApiErrorKind, status?: number) {
    super(message);
    this.name = 'UniFiApiError';
    this.kind = kind;
    this.status = status;
  }
}

export interface UniFiConsole {
  hostId: string;
  name: string;
  type: string | null;
  state: string | null;
}

export interface UniFiSite {
  hostId: string;
  hostName: string;
  siteId: string;
  name: string;
}

export interface UniFiSiteListFailure {
  hostId: string;
  hostName: string;
  message: string;
}

export interface UniFiDevice {
  /** Network application device id (UUID); null only when the API omits it. */
  id: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  name: string | null;
  model: string | null;
  serialNumber: string | null;
  /** Raw state string, e.g. ONLINE / OFFLINE / PENDING_ADOPTION. Mapper classifies it. */
  state: string | null;
  firmwareVersion: string | null;
  firmwareUpdatable: boolean | null;
  features: string[];
  uplinkDeviceId: string | null;
  /** ISO timestamp of the last state change / last seen, when the API exposes one. */
  stateChangedAt: string | null;
  raw: Record<string, unknown>;
}

export interface UniFiApiClientOptions {
  apiKey: string;
  mode?: UniFiConnectionMode;
  /** Required in local mode; ignored in site_manager mode. */
  localBaseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Upper bound for a single Retry-After wait. */
  maxRetryDelaySeconds?: number;
  requestTimeoutMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Called (best effort) when the API rejects the key with 401/403. */
  onAuthFailure?: (status: number) => Promise<void> | void;
}

const PAGE_LIMIT = 200;
const SITE_MANAGER_PAGE_SIZE = '100';
/** Hard stop so a misbehaving cursor can never spin forever; hitting it throws. */
const MAX_PAGES = 500;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Validates and normalizes a user-supplied local controller URL. Only the
 * origin is kept (paths and query strings are dropped). Credentials in the URL
 * and cloud-metadata / loopback targets are rejected so the server cannot be
 * pointed at its own host; private LAN ranges stay allowed because that is what
 * a local controller is.
 */
export function normalizeLocalBaseUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new UniFiApiError('The controller URL is not a valid URL.', 'config');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UniFiApiError('The controller URL must start with https:// or http://.', 'config');
  }
  if (parsed.username || parsed.password) {
    throw new UniFiApiError('The controller URL must not contain credentials.', 'config');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '0.0.0.0'
  ) {
    throw new UniFiApiError('The controller URL must point at the UniFi controller, not a loopback or link-local address.', 'config');
  }
  return parsed.origin;
}

export class UniFiApiClient {
  readonly mode: UniFiConnectionMode;
  private readonly apiKey: string;
  private readonly localBaseUrl: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly maxRetryDelaySeconds: number;
  private readonly requestTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onAuthFailure?: (status: number) => Promise<void> | void;

  constructor(options: UniFiApiClientOptions) {
    if (!options.apiKey) {
      throw new UniFiApiError('A UniFi API key is required.', 'config');
    }
    this.apiKey = options.apiKey;
    this.mode = options.mode ?? 'site_manager';
    if (this.mode === 'local') {
      if (!options.localBaseUrl) {
        throw new UniFiApiError('A controller URL is required for local mode.', 'config');
      }
      this.localBaseUrl = normalizeLocalBaseUrl(options.localBaseUrl);
    } else {
      this.localBaseUrl = null;
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxRetryDelaySeconds = options.maxRetryDelaySeconds ?? 30;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.onAuthFailure = options.onAuthFailure;
  }

  /** Strips the API key from any text that might be surfaced to a user or a log. */
  private redact(text: string): string {
    return this.apiKey ? text.split(this.apiKey).join('[redacted]') : text;
  }

  private retryDelaySeconds(header: string | null, attempt: number): number {
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, this.maxRetryDelaySeconds);
      const date = Date.parse(header);
      if (!Number.isNaN(date)) {
        return Math.min(Math.max(0, (date - Date.now()) / 1000), this.maxRetryDelaySeconds);
      }
    }
    return Math.min(2 ** attempt, this.maxRetryDelaySeconds);
  }

  private async request(url: URL): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: { 'X-API-KEY': this.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new UniFiApiError(`Unable to reach UniFi: ${this.redact(message)}`, 'network');
      }

      if (response.status === 429) {
        if (attempt < this.maxRetries) {
          attempt += 1;
          await this.sleep(this.retryDelaySeconds(response.headers.get('retry-after'), attempt) * 1000);
          continue;
        }
        throw new UniFiApiError(
          'UniFi rate limit reached and retries were exhausted. Wait a few minutes and try again, or reduce how often syncs run.',
          'rate_limited',
          429
        );
      }

      if (response.status === 401 || response.status === 403) {
        try {
          await this.onAuthFailure?.(response.status);
        } catch {
          // Marking the integration is best effort; the caller still gets the error.
        }
        throw new UniFiApiError(
          'UniFi rejected the API key. Create a new key and reconnect the integration.',
          'auth',
          response.status
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new UniFiApiError(
          `UniFi request failed with status ${response.status}: ${this.redact(body).slice(0, 300)}`,
          'http',
          response.status
        );
      }

      const text = await response.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw new UniFiApiError('UniFi returned a non-JSON response body.', 'invalid_response', response.status);
      }
    }
  }

  // ── URL construction (endpoint assumptions) ──────────────────────────────

  private cloudUrl(path: string, params: Record<string, string | undefined> = {}): URL {
    return this.withParams(new URL(`${UNIFI_CLOUD_BASE_URL}${path}`), params);
  }

  private withParams(url: URL, params: Record<string, string | undefined>): URL {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value !== 'undefined' && value !== '') url.searchParams.set(key, value);
    }
    return url;
  }

  /** Network Integration API root for a console: connector proxy (cloud) or direct (local). */
  private networkUrl(hostId: string, path: string, params: Record<string, string | undefined> = {}): URL {
    if (this.mode === 'local') {
      return this.withParams(new URL(`${this.localBaseUrl}/proxy/network/integration/v1${path}`), params);
    }
    return this.withParams(
      new URL(
        `${UNIFI_CLOUD_BASE_URL}/v1/connector/consoles/${encodeURIComponent(hostId)}/proxy/network/integration/v1${path}`
      ),
      params
    );
  }

  // ── Pagination ───────────────────────────────────────────────────────────

  /** Site Manager lists: `{ data: [], nextToken? }`. */
  private async listSiteManager(path: string, params: Record<string, string | undefined> = {}): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    const seenTokens = new Set<string>();
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = asRecord(
        await this.request(this.cloudUrl(path, { ...params, pageSize: SITE_MANAGER_PAGE_SIZE, nextToken }))
      );
      if (!Array.isArray(body.data)) {
        throw new UniFiApiError('UniFi returned an unexpected list response.', 'invalid_response');
      }
      items.push(...body.data.map(asRecord));
      const token = asString(body.nextToken);
      if (!token) return items;
      if (seenTokens.has(token)) {
        throw new UniFiApiError('UniFi pagination did not advance; refusing to return a partial list.', 'invalid_response');
      }
      seenTokens.add(token);
      nextToken = token;
    }
    throw new UniFiApiError('UniFi list exceeded the page limit; refusing to return a partial list.', 'invalid_response');
  }

  /** Integration API lists: `{ offset, limit, count, totalCount, data: [] }`. */
  private async listIntegration(hostId: string, path: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = asRecord(
        await this.request(this.networkUrl(hostId, path, { offset: String(offset), limit: String(PAGE_LIMIT) }))
      );
      if (!Array.isArray(body.data)) {
        throw new UniFiApiError('UniFi returned an unexpected list response.', 'invalid_response');
      }
      const data = body.data.map(asRecord);
      items.push(...data);
      offset += data.length;

      const total = typeof body.totalCount === 'number' ? body.totalCount : null;
      if (data.length === 0) {
        if (total !== null && offset < total) {
          throw new UniFiApiError('UniFi returned an empty page before the list was complete.', 'invalid_response');
        }
        return items;
      }
      if (total !== null) {
        if (offset >= total) return items;
      } else if (data.length < PAGE_LIMIT) {
        return items;
      }
    }
    throw new UniFiApiError('UniFi list exceeded the page limit; refusing to return a partial list.', 'invalid_response');
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async testConnection(): Promise<void> {
    if (this.mode === 'local') {
      await this.request(this.networkUrl(UNIFI_LOCAL_HOST_ID, '/sites', { offset: '0', limit: '1' }));
      return;
    }
    await this.request(this.cloudUrl('/v1/hosts', { pageSize: '1' }));
  }

  async listConsoles(): Promise<UniFiConsole[]> {
    if (this.mode === 'local') {
      return [{ hostId: UNIFI_LOCAL_HOST_ID, name: 'Local controller', type: 'local', state: null }];
    }
    const hosts = await this.listSiteManager('/v1/hosts');
    const consoles: UniFiConsole[] = [];
    for (const host of hosts) {
      const hostId = asString(host.id);
      if (!hostId) continue;
      const reported = asRecord(host.reportedState);
      consoles.push({
        hostId,
        name: asString(reported.name) ?? asString(reported.hostname) ?? asString(host.name) ?? hostId,
        type: asString(host.type),
        state: asString(reported.state),
      });
    }
    return consoles;
  }

  /**
   * Lists the Network sites of every console. A console whose listing fails is
   * reported in `failures` instead of aborting the others; callers decide what a
   * failure means (scope sync warns; device sync must fail closed for that host).
   */
  async listSites(): Promise<{ sites: UniFiSite[]; failures: UniFiSiteListFailure[] }> {
    const consoles = await this.listConsoles();
    const sites: UniFiSite[] = [];
    const failures: UniFiSiteListFailure[] = [];
    for (const console of consoles) {
      try {
        sites.push(...(await this.listSitesForHost(console)));
      } catch (error) {
        if (error instanceof UniFiApiError && error.kind === 'auth') throw error;
        failures.push({
          hostId: console.hostId,
          hostName: console.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { sites, failures };
  }

  async listSitesForHost(console: Pick<UniFiConsole, 'hostId' | 'name'>): Promise<UniFiSite[]> {
    const rows = await this.listIntegration(console.hostId, '/sites');
    const sites: UniFiSite[] = [];
    for (const row of rows) {
      const siteId = asString(row.id);
      if (!siteId) continue;
      sites.push({
        hostId: console.hostId,
        hostName: console.name,
        siteId,
        name: asString(row.name) ?? asString(row.internalReference) ?? siteId,
      });
    }
    return sites;
  }

  /** Throws if any page fails: a partial device list must never look complete. */
  async listDevices(site: Pick<UniFiSite, 'hostId' | 'siteId'>): Promise<UniFiDevice[]> {
    const rows = await this.listIntegration(site.hostId, `/sites/${encodeURIComponent(site.siteId)}/devices`);
    return rows.map(parseDevice);
  }

  async getDevice(site: Pick<UniFiSite, 'hostId' | 'siteId'>, deviceId: string): Promise<UniFiDevice> {
    const body = await this.request(
      this.networkUrl(site.hostId, `/sites/${encodeURIComponent(site.siteId)}/devices/${encodeURIComponent(deviceId)}`)
    );
    return parseDevice(asRecord(body));
  }
}

/**
 * Parses one Integration API device. List items carry `features` as an array of
 * strings; the detail payload carries an object keyed by feature name, so both
 * are accepted. Every field is optional on purpose.
 */
export function parseDevice(row: Record<string, unknown>): UniFiDevice {
  const features = Array.isArray(row.features)
    ? row.features.filter((value): value is string => typeof value === 'string')
    : Object.keys(asRecord(row.features));
  const uplink = asRecord(row.uplink);
  return {
    id: asString(row.id),
    macAddress: asString(row.macAddress) ?? asString(row.mac),
    ipAddress: asString(row.ipAddress) ?? asString(row.ip),
    name: asString(row.name),
    model: asString(row.model),
    serialNumber: asString(row.serialNumber) ?? asString(row.serial),
    state: asString(row.state) ?? asString(row.status),
    firmwareVersion: asString(row.firmwareVersion) ?? asString(row.version),
    firmwareUpdatable: typeof row.firmwareUpdatable === 'boolean' ? row.firmwareUpdatable : null,
    features,
    uplinkDeviceId: asString(uplink.deviceId),
    stateChangedAt:
      asString(row.lastStateChangeAt) ?? asString(row.stateChangedAt) ?? asString(row.lastSeenAt) ?? asString(row.lastSeen),
    raw: row,
  };
}

export interface UniFiClientFactoryOptions {
  /** Override how a 401/403 is recorded; defaults to marking the integration reconnect-required. */
  onAuthFailure?: (status: number) => Promise<void> | void;
}

export interface UniFiStoredCredentials {
  apiKey: string | null;
  localBaseUrl: string | null;
}

export async function readUniFiCredentials(tenant: string): Promise<UniFiStoredCredentials> {
  const secretProvider = await getSecretProviderInstance();
  const [apiKey, localBaseUrl] = await Promise.all([
    secretProvider.getTenantSecret(tenant, UNIFI_API_KEY_SECRET),
    secretProvider.getTenantSecret(tenant, UNIFI_LOCAL_BASE_URL_SECRET),
  ]);
  return { apiKey: apiKey || null, localBaseUrl: localBaseUrl || null };
}

/**
 * Builds a client from the tenant's stored secrets. `mode` comes from
 * rmm_integrations.settings.connectionMode and defaults to Site Manager.
 */
export async function createUniFiClient(
  tenant: string,
  mode: UniFiConnectionMode = 'site_manager',
  options: UniFiClientFactoryOptions = {}
): Promise<UniFiApiClient> {
  const credentials = await readUniFiCredentials(tenant);
  if (!credentials.apiKey) {
    throw new UniFiApiError('UniFi API key is not configured for this tenant.', 'config');
  }
  return new UniFiApiClient({
    apiKey: credentials.apiKey,
    mode,
    localBaseUrl: credentials.localBaseUrl ?? undefined,
    onAuthFailure: options.onAuthFailure ?? (async () => {
      const { markUniFiReconnectRequired } = await import('./reconnect');
      await markUniFiReconnectRequired(tenant);
    }),
  });
}
