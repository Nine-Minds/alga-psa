/**
 * Level (level.io) v2 REST API client.
 *
 * Auth is a static API key sent as the `Authorization` header (no Bearer prefix).
 * All list endpoints are cursor-paginated: `{ data: T[], has_more: boolean }` with
 * `starting_after=<last item id>` and `limit` (max 100).
 */

import { getSecretProviderInstance } from '@alga-psa/core/secrets';

export const LEVELIO_API_KEY_SECRET = 'levelio_api_key';
export const LEVELIO_WEBHOOK_SECRET_KEY = 'levelio_webhook_secret';
export const DEFAULT_LEVELIO_BASE_URL = 'https://api.level.io';

export interface LevelIoGroup {
  id: string;
  parent_id?: string | null;
  child_ids?: string[];
  name: string;
  device_count?: number;
  descendent_device_count?: number;
}

export interface LevelIoOperatingSystem {
  full_operating_system?: string | null;
  major_version?: string | null;
  minor_version?: string | null;
  architecture?: string | null;
  install_date?: string | null;
  end_of_life?: boolean;
}

export interface LevelIoCpu {
  model?: string;
  clock_speed?: number;
  cores?: number;
}

export interface LevelIoDiskPartition {
  label?: string;
  mount_point?: string;
  encrypted?: boolean;
  primary?: boolean;
  size?: number;
  free_space?: number;
  file_system?: string;
}

export interface LevelIoNetworkInterface {
  description?: string;
  interface?: string;
  mac_address?: string;
  ip_addresses?: string[];
  gateway?: string | null;
  domain?: string | null;
  dhcp_server?: string | null;
  dns_servers?: string | null;
  label?: string;
}

export interface LevelIoSecurity {
  score?: number | null;
  risk?: string | null;
  patch_compliance?: boolean;
  patch_security_risk?: string;
  os_end_of_life?: boolean;
  primary_partition_encrypted?: boolean;
  firewall_provider?: string | null;
  firewall_enabled?: boolean | null;
  antivirus_provider?: string | null;
  antivirus_status?: string | null;
}

export interface LevelIoDevice {
  id: string;
  hostname: string;
  nickname?: string | null;
  role?: 'workstation' | 'server' | 'domain_controller' | null;
  group_id?: string | null;
  tags?: string[];
  flag?: string | null;
  maintenance_mode?: boolean;
  online: boolean;
  manufacturer?: string | null;
  model?: string | null;
  architecture?: string | null;
  serial_number?: string | null;
  total_memory?: number | null;
  memory_slots?: number | null;
  cpu_cores?: number | null;
  last_logged_in_user?: string | null;
  last_reboot_time?: string | null;
  last_seen_at?: string | null;
  city?: string | null;
  country?: string | null;
  security_score?: number | null;
  platform?: 'Windows' | 'Mac' | 'Linux' | null;
  operating_system?: LevelIoOperatingSystem;
  cpus?: LevelIoCpu[];
  disk_partitions?: LevelIoDiskPartition[];
  network_interfaces?: LevelIoNetworkInterface[];
  security?: LevelIoSecurity;
}

export interface LevelIoAlert {
  id: string;
  device_id: string;
  device_hostname: string;
  name: string;
  description: string;
  payload?: string | null;
  severity: 'information' | 'warning' | 'critical' | 'emergency';
  is_resolved: boolean;
  started_at: string;
  resolved_at?: string | null;
}

export interface LevelIoUpdate {
  id: string;
  device_id: string;
  device_hostname: string;
  name: string;
  category: string;
  is_available: boolean;
  installed_on?: string | null;
}

export class LevelIoApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LevelIoApiError';
    this.status = status;
  }
}

interface LevelIoListResponse<T> {
  data: T[];
  has_more?: boolean;
}

export interface LevelIoApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

const DEVICE_INCLUDE_PARAMS: Record<string, string> = {
  include_operating_system: 'true',
  include_cpus: 'true',
  include_memory: 'true',
  include_disks: 'true',
  include_network_interfaces: 'true',
  include_security: 'true',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LevelIoApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(options: LevelIoApiClientOptions) {
    if (!options.apiKey) {
      throw new LevelIoApiError('Level API key is required.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_LEVELIO_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private async request<T>(
    path: string,
    options?: { params?: Record<string, string | undefined>; method?: 'GET' | 'POST' }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options?.params ?? {})) {
      if (typeof value !== 'undefined' && value !== '') {
        url.searchParams.set(key, value);
      }
    }

    let attempt = 0;
    for (;;) {
      const response = await this.fetchImpl(url.toString(), {
        method: options?.method ?? 'GET',
        headers: {
          Authorization: this.apiKey,
          Accept: 'application/json',
        },
      });

      if (response.status === 429 && attempt < this.maxRetries) {
        attempt += 1;
        const retryAfterHeader = response.headers.get('retry-after');
        const parsed = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
        const delaySeconds = Number.isFinite(parsed) ? Math.min(parsed, 30) : Math.min(2 ** attempt, 30);
        await sleep(delaySeconds * 1000);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new LevelIoApiError(
          'Level rejected the API key. Generate a key in Level (Settings > API) and save it in the integration settings.',
          response.status
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new LevelIoApiError(
          `Level API request failed with status ${response.status}: ${body.slice(0, 300)}`,
          response.status
        );
      }

      const text = await response.text();
      if (!text) {
        return undefined as T;
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new LevelIoApiError('Level API returned a non-JSON response body.', response.status);
      }
    }
  }

  private async listAll<T extends { id: string }>(
    path: string,
    params?: Record<string, string | undefined>
  ): Promise<T[]> {
    const items: T[] = [];
    let startingAfter: string | undefined;

    for (;;) {
      const page = await this.request<LevelIoListResponse<T>>(path, {
        params: { ...params, limit: '100', starting_after: startingAfter },
      });
      const data = page?.data ?? [];
      items.push(...data);
      if (!page?.has_more || data.length === 0) {
        return items;
      }
      startingAfter = data[data.length - 1].id;
    }
  }

  async testConnection(): Promise<void> {
    await this.request('/v2/groups', { params: { limit: '1' } });
  }

  async listGroups(): Promise<LevelIoGroup[]> {
    return this.listAll<LevelIoGroup>('/v2/groups');
  }

  async listDevices(params?: { groupId?: string; ancestorGroupId?: string }): Promise<LevelIoDevice[]> {
    return this.listAll<LevelIoDevice>('/v2/devices', {
      ...DEVICE_INCLUDE_PARAMS,
      group_id: params?.groupId,
      ancestor_group_id: params?.ancestorGroupId,
    });
  }

  async getDevice(deviceId: string): Promise<LevelIoDevice> {
    return this.request<LevelIoDevice>(`/v2/devices/${encodeURIComponent(deviceId)}`, {
      params: DEVICE_INCLUDE_PARAMS,
    });
  }

  async listAlerts(params?: { deviceId?: string; status?: 'active' | 'resolved' }): Promise<LevelIoAlert[]> {
    return this.listAll<LevelIoAlert>('/v2/alerts', {
      device_id: params?.deviceId,
      status: params?.status,
    });
  }

  async resolveAlert(alertId: string): Promise<void> {
    await this.request(`/v2/alerts/${encodeURIComponent(alertId)}/resolve`, { method: 'POST' });
  }

  async listUpdates(params?: { deviceId?: string; status?: 'available' | 'installed' }): Promise<LevelIoUpdate[]> {
    return this.listAll<LevelIoUpdate>('/v2/updates', {
      device_id: params?.deviceId,
      status: params?.status,
    });
  }
}

export async function createLevelIoClient(tenant: string): Promise<LevelIoApiClient> {
  const secretProvider = await getSecretProviderInstance();
  const apiKey = (await secretProvider.getTenantSecret(tenant, LEVELIO_API_KEY_SECRET)) || '';
  if (!apiKey) {
    throw new LevelIoApiError('Level API key is not configured for this tenant.');
  }
  return new LevelIoApiClient({
    apiKey,
    baseUrl: process.env.LEVELIO_API_BASE_URL || DEFAULT_LEVELIO_BASE_URL,
  });
}
