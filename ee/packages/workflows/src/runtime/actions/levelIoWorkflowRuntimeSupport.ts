import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const LEVELIO_API_KEY_SECRET = 'levelio_api_key';
const DEFAULT_LEVELIO_BASE_URL = 'https://api.level.io';

export class LevelWorkflowApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LevelWorkflowApiError';
    this.status = status;
  }
}

export type LevelWorkflowClient = {
  listDevices(params?: { groupId?: string }): Promise<Record<string, unknown>[]>;
  getDevice(deviceId: string): Promise<Record<string, unknown>>;
  listAlerts(params?: { deviceId?: string; status?: 'active' | 'resolved' }): Promise<Record<string, unknown>[]>;
  resolveAlert(alertId: string): Promise<void>;
  listUpdates(params?: { deviceId?: string; status?: 'available' | 'installed' }): Promise<Record<string, unknown>[]>;
  listAutomations(): Promise<Record<string, unknown>[]>;
  listAutomationWebhooks(): Promise<Record<string, unknown>[]>;
  triggerAutomationWebhook(token: string, deviceIds?: string[]): Promise<unknown>;
  getAutomationRun(runId: string, includeSteps?: boolean): Promise<Record<string, unknown>>;
};

const DEVICE_INCLUDE_PARAMS: Record<string, string> = {
  include_operating_system: 'true',
  include_security: 'true'
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type LevelListResponse = {
  data?: unknown[];
  has_more?: boolean;
};

// Self-contained Level (level.io) v2 client for workflow actions; the
// fuller ee/server client is not importable across the package boundary.
// Auth is the raw API key in the Authorization header (no Bearer prefix);
// lists are cursor-paginated via starting_after.
export class FetchLevelWorkflowClient implements LevelWorkflowClient {
  private apiKey: string | null = null;

  constructor(
    private readonly tenantId: string,
    private readonly baseUrl: string = process.env.LEVELIO_API_BASE_URL || DEFAULT_LEVELIO_BASE_URL
  ) {}

  private async loadApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey;
    const secretProvider = await getSecretProviderInstance();
    const apiKey = await secretProvider.getTenantSecret(this.tenantId, LEVELIO_API_KEY_SECRET);
    if (!apiKey) {
      throw new LevelWorkflowApiError('Level API key is not configured for this tenant.');
    }
    this.apiKey = apiKey;
    return apiKey;
  }

  private async request(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      params?: Record<string, string | undefined>;
      body?: unknown;
    } = {}
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl.replace(/\/+$/, '')}${path}`);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    const apiKey = await this.loadApiKey();

    let attempt = 0;
    for (;;) {
      const response = await fetch(url.toString(), {
        method: options.method ?? 'GET',
        headers: {
          Authorization: apiKey,
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
      });

      if (response.status === 429 && attempt < 3) {
        attempt += 1;
        const retryAfterHeader = response.headers.get('retry-after');
        const parsed = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
        const delaySeconds = Number.isFinite(parsed) ? Math.min(parsed, 30) : Math.min(2 ** attempt, 30);
        await sleep(delaySeconds * 1000);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new LevelWorkflowApiError(
          'Level rejected the API key. Generate a key in Level (Settings > API) and save it in the integration settings.',
          response.status
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new LevelWorkflowApiError(
          `Level API request failed with status ${response.status}: ${body.slice(0, 300)}`,
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

  private async listAll(path: string, params?: Record<string, string | undefined>): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const page = (await this.request(path, {
        params: { ...params, limit: '100', starting_after: startingAfter }
      })) as LevelListResponse | null;
      const data = (page?.data ?? []).filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
      );
      items.push(...data);
      if (!page?.has_more || data.length === 0) return items;
      startingAfter = String(data[data.length - 1].id ?? '');
      if (!startingAfter) return items;
    }
  }

  async listDevices(params: { groupId?: string } = {}): Promise<Record<string, unknown>[]> {
    return this.listAll('/v2/devices', { ...DEVICE_INCLUDE_PARAMS, group_id: params.groupId });
  }

  async getDevice(deviceId: string): Promise<Record<string, unknown>> {
    const data = await this.request(`/v2/devices/${encodeURIComponent(deviceId)}`, {
      params: DEVICE_INCLUDE_PARAMS
    });
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new LevelWorkflowApiError(`Level device ${deviceId} returned an unexpected response`);
    }
    return data as Record<string, unknown>;
  }

  async listAlerts(params: { deviceId?: string; status?: 'active' | 'resolved' } = {}): Promise<Record<string, unknown>[]> {
    return this.listAll('/v2/alerts', { device_id: params.deviceId, status: params.status });
  }

  async resolveAlert(alertId: string): Promise<void> {
    await this.request(`/v2/alerts/${encodeURIComponent(alertId)}/resolve`, { method: 'POST' });
  }

  async listUpdates(params: { deviceId?: string; status?: 'available' | 'installed' } = {}): Promise<Record<string, unknown>[]> {
    return this.listAll('/v2/updates', { device_id: params.deviceId, status: params.status });
  }

  async listAutomations(): Promise<Record<string, unknown>[]> {
    return this.listAll('/v2/automations');
  }

  async listAutomationWebhooks(): Promise<Record<string, unknown>[]> {
    const data = await this.request('/v2/automations/webhooks');
    if (Array.isArray(data)) {
      return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    }
    if (data && typeof data === 'object' && Array.isArray((data as LevelListResponse).data)) {
      return ((data as LevelListResponse).data ?? []).filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
      );
    }
    return [];
  }

  async triggerAutomationWebhook(token: string, deviceIds?: string[]): Promise<unknown> {
    return this.request(`/v2/automations/webhooks/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: deviceIds && deviceIds.length > 0 ? { device_ids: deviceIds } : {}
    });
  }

  async getAutomationRun(runId: string, includeSteps = false): Promise<Record<string, unknown>> {
    const data = await this.request(`/v2/automation-runs/${encodeURIComponent(runId)}`, {
      params: includeSteps ? { include_steps: 'true' } : {}
    });
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new LevelWorkflowApiError(`Level automation run ${runId} returned an unexpected response`);
    }
    return data as Record<string, unknown>;
  }
}

export async function createLevelWorkflowClient(tenantId: string): Promise<LevelWorkflowClient> {
  return new FetchLevelWorkflowClient(tenantId);
}
