import {
  buildRequest,
  type ChatApiRegistryEntry,
  type CallEndpointArgs,
} from '@alga-psa/agent-tooling';
import type { ConnectorConfig } from './config.js';
import { describeHttpFailure } from './errors.js';

export interface EndpointResult {
  status: number;
  ok: boolean;
  data: unknown;
}

export interface BusinessSearchArgs {
  query?: unknown;
  types?: unknown;
  limit?: unknown;
  cursor?: unknown;
  sort?: unknown;
}

/**
 * Thin HTTP client to a remote AlgaPSA instance. Holds the user's API token and
 * calls the public /api/v1 surface — no server internals. All requests are
 * authenticated with the configured token; no governance (this is the
 * user-scoped local connector).
 */
export class InstanceClient {
  constructor(private readonly config: ConnectorConfig) {}

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'x-api-key': this.config.apiToken,
      accept: 'application/json',
    };
    if (this.config.tenantId) {
      headers['x-tenant-id'] = this.config.tenantId;
    }
    return headers;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch the endpoint registry from the instance. Throws on failure (fatal at startup). */
  async fetchRegistry(): Promise<ChatApiRegistryEntry[]> {
    const url = `${this.config.instanceUrl}${this.config.registryPath}`;
    let res: Response;
    try {
      res = await this.fetchWithTimeout(url, { method: 'GET', headers: this.authHeaders() });
    } catch (error) {
      throw new Error(
        `Could not reach the AlgaPSA registry at ${url}: ${(error as Error).message}. ` +
          'Check ALGA_INSTANCE_URL and network connectivity.',
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Failed to load the API registry from ${url}: ${describeHttpFailure(res.status, res.statusText, body)}`,
      );
    }
    const json = (await res.json().catch(() => null)) as unknown;
    // Tolerate Alga's standard envelope ({ data: { entries } }), a bare
    // { entries }, or a raw array.
    const payload =
      json && typeof json === 'object' && 'data' in json
        ? (json as { data?: unknown }).data
        : json;
    const entries = Array.isArray(payload)
      ? payload
      : (payload as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries)) {
      throw new Error(`Registry response from ${url} did not contain an "entries" array.`);
    }
    return entries as ChatApiRegistryEntry[];
  }

  /** Cross-entity business-data search via GET /api/v1/search. */
  async searchBusinessData(args: BusinessSearchArgs): Promise<EndpointResult> {
    const url = new URL(`${this.config.instanceUrl}${this.config.searchPath}`);
    if (typeof args.query === 'string') url.searchParams.set('query', args.query);
    if (Array.isArray(args.types) && args.types.length > 0) {
      url.searchParams.set('types', args.types.map(String).join(','));
    }
    if (args.limit !== undefined && args.limit !== null) url.searchParams.set('limit', String(args.limit));
    if (args.cursor) url.searchParams.set('cursor', String(args.cursor));
    if (args.sort) url.searchParams.set('sort', String(args.sort));
    return this.send(url.toString(), { method: 'GET', headers: this.authHeaders() });
  }

  /** Invoke a registry endpoint, building the request from the entry + args. */
  async callEndpoint(entry: ChatApiRegistryEntry, args: CallEndpointArgs): Promise<EndpointResult> {
    const built = buildRequest(entry, args);
    const url = new URL(`${this.config.instanceUrl}${built.path}`);
    for (const [key, value] of Object.entries(built.query)) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { ...built.headers, ...this.authHeaders() };
    const init: RequestInit = { method: built.method, headers };
    if (built.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      init.body = built.body;
    }
    return this.send(url.toString(), init);
  }

  private async send(url: string, init: RequestInit): Promise<EndpointResult> {
    let res: Response;
    try {
      res = await this.fetchWithTimeout(url, init);
    } catch (error) {
      throw new Error(`Request to ${url} failed: ${(error as Error).message}`);
    }
    const text = await res.text().catch(() => '');
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const detail = typeof data === 'string' ? data : JSON.stringify(data);
      return {
        status: res.status,
        ok: false,
        data: { error: describeHttpFailure(res.status, res.statusText, detail) },
      };
    }
    return { status: res.status, ok: true, data };
  }
}
