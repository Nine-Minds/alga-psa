import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const NINJAONE_CLIENT_ID_SECRET = 'ninjaone_client_id';
const NINJAONE_CLIENT_SECRET_SECRET = 'ninjaone_client_secret';
const NINJAONE_CREDENTIALS_SECRET = 'ninjaone_credentials';
const DEFAULT_NINJAONE_INSTANCE_URL = 'https://app.ninjarmm.com';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_NINJAONE_SYNC_TASK_QUEUE = 'alga-jobs';

type NinjaOneOAuthCredentials = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  instance_url?: string;
};

type NinjaOneTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export type NinjaOneRunScriptPayload = {
  type: 'SCRIPT' | 'ACTION';
  id?: number;
  uid?: string;
  parameters?: string;
  runAs?: string;
};

export type NinjaOneWorkflowClient = {
  getDevice(deviceId: number): Promise<Record<string, unknown>>;
  getDevices(params?: { pageSize?: number; df?: string }): Promise<Record<string, unknown>[]>;
  getAlerts(params?: { pageSize?: number }): Promise<Record<string, unknown>[]>;
  rebootDevice(deviceId: number): Promise<void>;
  resetAlert(alertUid: string): Promise<void>;
  getScriptingOptions(deviceId: number): Promise<Record<string, unknown>>;
  runScript(deviceId: number, payload: NinjaOneRunScriptPayload): Promise<unknown>;
};

type FetchRequestOptions = {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  retryOnUnauthorized?: boolean;
};

const normalizeInstanceUrl = (instanceUrl: string): string => instanceUrl.replace(/\/+$/, '').replace(/\/api(?:\/v2)?$/, '');

const buildApiBaseUrl = (instanceUrl: string): string => `${normalizeInstanceUrl(instanceUrl)}/api/v2`;

const getResponseText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await getResponseText(response);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const extractCursorFromLink = (linkHeader: string | null): string | undefined => {
  if (!linkHeader) return undefined;
  const nextLink = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/i.test(part));
  if (!nextLink) return undefined;

  const urlMatch = nextLink.match(/<([^>]+)>/);
  if (!urlMatch?.[1]) return undefined;

  try {
    const parsed = new URL(urlMatch[1]);
    return parsed.searchParams.get('after') ?? parsed.searchParams.get('cursor') ?? undefined;
  } catch {
    return undefined;
  }
};

const asRecordArray = (value: unknown, collectionKey: string): { items: Record<string, unknown>[]; cursor?: string } => {
  if (Array.isArray(value)) {
    return { items: value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const collection = record[collectionKey];
    if (Array.isArray(collection)) {
      return {
        items: collection.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)),
        cursor: typeof record.cursor === 'string' ? record.cursor : undefined,
      };
    }
  }
  return { items: [] };
};

class FetchNinjaOneWorkflowClient implements NinjaOneWorkflowClient {
  private credentials: NinjaOneOAuthCredentials | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(private readonly tenantId: string) {}

  private async loadCredentials(): Promise<NinjaOneOAuthCredentials | null> {
    if (this.credentials) return this.credentials;
    const secretProvider = await getSecretProviderInstance();
    const credentialsJson = await secretProvider.getTenantSecret(this.tenantId, NINJAONE_CREDENTIALS_SECRET);
    if (!credentialsJson) return null;
    const credentials = JSON.parse(credentialsJson) as NinjaOneOAuthCredentials;
    this.credentials = credentials;
    return credentials;
  }

  private async saveCredentials(credentials: NinjaOneOAuthCredentials): Promise<void> {
    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(this.tenantId, NINJAONE_CREDENTIALS_SECRET, JSON.stringify(credentials));
    this.credentials = credentials;
  }

  private async resolveClientCredentials(): Promise<{ clientId?: string; clientSecret?: string }> {
    const secretProvider = await getSecretProviderInstance();
    const tenantClientId = await secretProvider.getTenantSecret(this.tenantId, NINJAONE_CLIENT_ID_SECRET);
    const tenantClientSecret = await secretProvider.getTenantSecret(this.tenantId, NINJAONE_CLIENT_SECRET_SECRET);

    return {
      clientId: tenantClientId || await secretProvider.getAppSecret(NINJAONE_CLIENT_ID_SECRET) || process.env.NINJAONE_CLIENT_ID,
      clientSecret: tenantClientSecret || await secretProvider.getAppSecret(NINJAONE_CLIENT_SECRET_SECRET) || process.env.NINJAONE_CLIENT_SECRET,
    };
  }

  private async getValidAccessToken(): Promise<string> {
    const credentials = await this.loadCredentials();
    if (!credentials?.access_token) {
      throw new Error('NinjaOne credentials are not configured for this tenant');
    }

    if (Date.now() >= credentials.expires_at - TOKEN_REFRESH_BUFFER_MS) {
      await this.refreshAccessToken();
    }

    if (!this.credentials?.access_token) {
      throw new Error('NinjaOne access token is unavailable after refresh');
    }
    return this.credentials.access_token;
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const credentials = await this.loadCredentials();
      if (!credentials?.refresh_token) {
        throw new Error('No NinjaOne refresh token available');
      }

      const { clientId, clientSecret } = await this.resolveClientCredentials();
      if (!clientId || !clientSecret) {
        throw new Error('NinjaOne client credentials are not configured');
      }

      const instanceUrl = normalizeInstanceUrl(credentials.instance_url || DEFAULT_NINJAONE_INSTANCE_URL);
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetch(`${instanceUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        const body = await getResponseText(response);
        throw new Error(`NinjaOne token refresh failed (${response.status}): ${body || response.statusText}`);
      }

      const token = await response.json() as NinjaOneTokenResponse;
      await this.saveCredentials({
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? credentials.refresh_token,
        expires_at: Date.now() + token.expires_in * 1000,
        instance_url: instanceUrl,
      });
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async request(path: string, options: FetchRequestOptions = {}): Promise<{ data: unknown; linkHeader: string | null }> {
    const credentials = await this.loadCredentials();
    const instanceUrl = normalizeInstanceUrl(credentials?.instance_url || DEFAULT_NINJAONE_INSTANCE_URL);
    const url = new URL(`${buildApiBaseUrl(instanceUrl)}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const accessToken = await this.getValidAccessToken();
    const response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    if (response.status === 401 && options.retryOnUnauthorized !== false) {
      await this.refreshAccessToken();
      return this.request(path, { ...options, retryOnUnauthorized: false });
    }

    if (!response.ok) {
      const body = await getResponseText(response);
      throw new Error(`NinjaOne API request failed (${response.status}) for ${path}: ${body || response.statusText}`);
    }

    if (response.status === 204) {
      return { data: null, linkHeader: response.headers.get('link') };
    }

    return {
      data: await parseJsonResponse(response),
      linkHeader: response.headers.get('link'),
    };
  }

  async getDevice(deviceId: number): Promise<Record<string, unknown>> {
    const { data } = await this.request(`/device/${deviceId}`);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`NinjaOne device ${deviceId} returned an unexpected response`);
    }
    return data as Record<string, unknown>;
  }

  async getDevices(params: { pageSize?: number; df?: string } = {}): Promise<Record<string, unknown>[]> {
    const devices: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    do {
      const { data, linkHeader } = await this.request('/devices', {
        query: { pageSize: params.pageSize ?? 100, df: params.df, after: cursor },
      });
      const page = asRecordArray(data, 'devices');
      devices.push(...page.items);
      cursor = extractCursorFromLink(linkHeader) ?? page.cursor;
    } while (cursor);
    return devices;
  }

  async getAlerts(params: { pageSize?: number } = {}): Promise<Record<string, unknown>[]> {
    const alerts: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    do {
      const { data, linkHeader } = await this.request('/alerts', {
        query: { pageSize: params.pageSize ?? 100, after: cursor },
      });
      const page = asRecordArray(data, 'alerts');
      alerts.push(...page.items);
      cursor = extractCursorFromLink(linkHeader) ?? page.cursor;
    } while (cursor);
    return alerts;
  }

  async rebootDevice(deviceId: number): Promise<void> {
    await this.request(`/device/${deviceId}/control/reboot`, { method: 'POST' });
  }

  async resetAlert(alertUid: string): Promise<void> {
    await this.request(`/alert/${encodeURIComponent(alertUid)}/reset`, { method: 'POST' });
  }

  async getScriptingOptions(deviceId: number): Promise<Record<string, unknown>> {
    const { data } = await this.request(`/device/${deviceId}/scripting/options`);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`NinjaOne scripting options for device ${deviceId} returned an unexpected response`);
    }
    return data as Record<string, unknown>;
  }

  async runScript(deviceId: number, payload: NinjaOneRunScriptPayload): Promise<unknown> {
    const { data } = await this.request(`/device/${deviceId}/script/run`, {
      method: 'POST',
      body: payload,
    });
    return data;
  }
}

export async function createNinjaOneWorkflowClient(tenantId: string, _integrationId: string): Promise<NinjaOneWorkflowClient> {
  return new FetchNinjaOneWorkflowClient(tenantId);
}

export async function syncNinjaOneDevice(input: {
  tenantId: string;
  integrationId: string;
  deviceId: number;
}): Promise<{ asset_id?: string | null }> {
  const temporal = await import('@temporalio/client');
  const connection = await temporal.Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS,
  });

  const client = new temporal.Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE,
  });

  const workflowId = `ninjaone:device:${input.tenantId}:${input.deviceId}:${Date.now()}`;
  try {
    const handle = await client.workflow.start('ninjaOneDeviceSyncWorkflow', {
      taskQueue: process.env.TEMPORAL_JOB_TASK_QUEUE || DEFAULT_NINJAONE_SYNC_TASK_QUEUE,
      workflowId,
      args: [{
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        deviceId: input.deviceId,
      }],
    });

    return await handle.result();
  } finally {
    await connection.close().catch(() => undefined);
  }
}
