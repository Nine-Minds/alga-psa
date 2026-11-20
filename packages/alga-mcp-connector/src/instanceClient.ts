import {
  readResponseBody,
  type BuiltRequest,
  type ChatApiRegistryEntry,
  type MetaToolTransport,
  type UpstreamBody,
} from '@alga-psa/agent-tooling';
import type { ConnectorConfig } from './config.js';
import { describeHttpFailure } from './errors.js';

export interface EndpointResult {
  status: number;
  ok: boolean;
  body: UpstreamBody;
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

  /** Where `search_business_data` goes (operators may override ALGA_SEARCH_PATH). */
  get searchPath(): string {
    return this.config.searchPath;
  }

  /** The transport `dispatchMetaTool` sends every tool's request through. */
  transport(): MetaToolTransport {
    return { send: (req) => this.sendBuilt(req) };
  }

  /** Send an already-built request (the output of any meta-tool request builder). */
  async sendBuilt(built: BuiltRequest): Promise<EndpointResult> {
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
    const body = await readResponseBody(res);
    if (!res.ok) {
      const detail =
        body.kind === 'binary'
          ? `[binary ${body.contentType}]`
          : typeof body.value === 'string'
            ? body.value
            : JSON.stringify(body.value);
      return {
        status: res.status,
        ok: false,
        body: { kind: 'json', value: { error: describeHttpFailure(res.status, res.statusText, detail) } },
      };
    }
    return { status: res.status, ok: true, body };
  }
}
