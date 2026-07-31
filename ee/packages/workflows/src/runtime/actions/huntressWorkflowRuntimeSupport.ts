import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const HUNTRESS_API_KEY_SECRET = 'huntress_api_key';
const HUNTRESS_API_SECRET_SECRET = 'huntress_api_secret';
const DEFAULT_HUNTRESS_BASE_URL = 'https://api.huntress.io';

// Mirrors the ee/server HuntressClient throttle: 60 req/min sliding window,
// spaced requests plus bounded 429 retries.
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1_100;
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 10_000;

export class HuntressWorkflowApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HuntressWorkflowApiError';
    this.status = status;
  }
}

export type HuntressIncidentFilters = {
  status?: string;
  severity?: string;
  platform?: string;
  organization_id?: number;
  agent_id?: number;
  limit?: number;
};

export type HuntressWorkflowClient = {
  getAccount(): Promise<Record<string, unknown>>;
  listOrganizations(): Promise<Record<string, unknown>[]>;
  listIncidentReports(filters?: HuntressIncidentFilters): Promise<Record<string, unknown>[]>;
  getIncidentReport(id: number): Promise<Record<string, unknown>>;
  resolveIncidentReport(id: number): Promise<Record<string, unknown> | null>;
  getAgent(id: number): Promise<Record<string, unknown>>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class FetchHuntressWorkflowClient implements HuntressWorkflowClient {
  private credentials: { apiKey: string; apiSecret: string } | null = null;
  private lastRequestAt = 0;

  constructor(
    private readonly tenantId: string,
    private readonly baseUrl: string = DEFAULT_HUNTRESS_BASE_URL,
    private readonly minIntervalMs: number = DEFAULT_MIN_REQUEST_INTERVAL_MS,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep
  ) {}

  private async loadCredentials(): Promise<{ apiKey: string; apiSecret: string }> {
    if (this.credentials) return this.credentials;
    const secretProvider = await getSecretProviderInstance();
    const apiKey = await secretProvider.getTenantSecret(this.tenantId, HUNTRESS_API_KEY_SECRET);
    const apiSecret = await secretProvider.getTenantSecret(this.tenantId, HUNTRESS_API_SECRET_SECRET);
    if (!apiKey || !apiSecret) {
      throw new HuntressWorkflowApiError('Huntress API credentials are not configured for this tenant.');
    }
    this.credentials = { apiKey, apiSecret };
    return this.credentials;
  }

  private async request(
    path: string,
    options: { method?: 'GET' | 'POST'; params?: Record<string, string | number | undefined> } = {}
  ): Promise<unknown> {
    const { apiKey, apiSecret } = await this.loadCredentials();
    const url = new URL(`${this.baseUrl.replace(/\/+$/, '')}${path}`);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const token = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();

      const response = await fetch(url.toString(), {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${token}`
        }
      });

      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const retryAfterRaw = response.headers.get('retry-after');
        const retryAfter = Number(retryAfterRaw);
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RATE_LIMIT_BACKOFF_MS;
        await this.sleep(backoff);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new HuntressWorkflowApiError(
          `Huntress API request failed with status ${response.status}: ${body.slice(0, 300)}`,
          response.status
        );
      }

      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }

  async getAccount(): Promise<Record<string, unknown>> {
    const data = (await this.request('/v1/account')) as Record<string, unknown> | null;
    const account = (data?.account ?? data) as Record<string, unknown> | null;
    if (!account || typeof account !== 'object') {
      throw new HuntressWorkflowApiError('Huntress account returned an unexpected response');
    }
    return account;
  }

  async listOrganizations(): Promise<Record<string, unknown>[]> {
    const organizations: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    do {
      const page = (await this.request('/v1/organizations', {
        params: { limit: 500, page_token: pageToken }
      })) as Record<string, unknown> | null;
      const items = Array.isArray(page?.organizations) ? (page!.organizations as Record<string, unknown>[]) : [];
      organizations.push(...items);
      const pagination = page?.pagination as Record<string, unknown> | undefined;
      pageToken = typeof pagination?.next_page_token === 'string' ? pagination.next_page_token : undefined;
    } while (pageToken);
    return organizations;
  }

  async listIncidentReports(filters: HuntressIncidentFilters = {}): Promise<Record<string, unknown>[]> {
    const target = Math.min(filters.limit ?? 50, 500);
    const incidents: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    do {
      const page = (await this.request('/v1/incident_reports', {
        params: {
          limit: Math.min(target, 500),
          page_token: pageToken,
          status: filters.status,
          severity: filters.severity,
          platform: filters.platform,
          organization_id: filters.organization_id,
          agent_id: filters.agent_id,
          sort_field: 'updated_at',
          sort_direction: 'desc'
        }
      })) as Record<string, unknown> | null;
      const items = Array.isArray(page?.incident_reports) ? (page!.incident_reports as Record<string, unknown>[]) : [];
      incidents.push(...items);
      const pagination = page?.pagination as Record<string, unknown> | undefined;
      pageToken = typeof pagination?.next_page_token === 'string' ? pagination.next_page_token : undefined;
    } while (pageToken && incidents.length < target);
    return incidents.slice(0, target);
  }

  async getIncidentReport(id: number): Promise<Record<string, unknown>> {
    const data = (await this.request(`/v1/incident_reports/${id}`)) as Record<string, unknown> | null;
    const incident = (data?.incident_report ?? data) as Record<string, unknown> | null;
    if (!incident || typeof incident !== 'object') {
      throw new HuntressWorkflowApiError(`Huntress incident report ${id} returned an unexpected response`);
    }
    return incident;
  }

  async resolveIncidentReport(id: number): Promise<Record<string, unknown> | null> {
    const data = (await this.request(`/v1/incident_reports/${id}/resolution`, { method: 'POST' })) as
      | Record<string, unknown>
      | null;
    return (data?.incident_report ?? data) as Record<string, unknown> | null;
  }

  async getAgent(id: number): Promise<Record<string, unknown>> {
    const data = (await this.request(`/v1/agents/${id}`)) as Record<string, unknown> | null;
    const agent = (data?.agent ?? data) as Record<string, unknown> | null;
    if (!agent || typeof agent !== 'object') {
      throw new HuntressWorkflowApiError(`Huntress agent ${id} returned an unexpected response`);
    }
    return agent;
  }
}

export async function createHuntressWorkflowClient(
  tenantId: string,
  baseUrl?: string
): Promise<HuntressWorkflowClient> {
  return new FetchHuntressWorkflowClient(tenantId, baseUrl || DEFAULT_HUNTRESS_BASE_URL);
}
