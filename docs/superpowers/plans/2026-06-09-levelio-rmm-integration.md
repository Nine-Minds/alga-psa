# Level.io RMM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Level.io RMM integration (provider key `levelio`, EE-only, Temporal-first sync) with group→client mapping, device/asset sync, pending-patch counts, alerts backfill, an inbound alert webhook, and a settings UI.

**Architecture:** A fetch-based `LevelIoApiClient` plus pure mapper functions feed a sync engine (`runLevelIo*` functions) that is the single source of truth, called by both a direct executor (in server actions) and Temporal activities (in `ee/temporal-workflows`). Server actions route through the existing `runRmmSyncWithTransport()` with a `temporal` default for this provider. Device ingestion goes through the shared `ingestNormalizedRmmDeviceSnapshot` service — no new DB tables or migrations.

**Tech Stack:** TypeScript, Next.js server actions, Knex, Temporal (`@temporalio/client`/`workflow`/`activity`), Vitest, React + `@alga-psa/ui` components.

**Spec:** `docs/superpowers/specs/2026-06-09-levelio-rmm-integration-design.md`

**Key facts the engineer needs:**
- Level v2 REST API: base `https://api.level.io`, static API key sent as the `Authorization` header (no `Bearer` prefix). Cursor pagination: every list response is `{ data: T[], has_more: boolean }`; pass `starting_after=<last item id>` and `limit` (max 100). Show endpoints (`GET /v2/devices/{id}`) return the bare object, not wrapped.
- `@alga-psa/shared/rmm/contracts` and `@alga-psa/shared/rmm/sharedAssetIngestionService` are the canonical shared-RMM modules; they resolve in **both** `ee/server` and `ee/temporal-workflows` (the `packages/integrations` copies are just re-exports).
- The Temporal worker resolves `@ee/*` → `ee/server/src/*`, so worker activities import the sync engine without duplication (same pattern as NinjaOne).
- All RMM tables (`rmm_integrations`, `rmm_organization_mappings`, `rmm_alerts`, `tenant_external_entity_mappings`, asset extension tables) are provider-agnostic; **no migrations in this plan**.
- `rmm_alerts` columns (per `server/migrations/20251124000001_create_rmm_integration_tables.cjs`) include `source_type` (varchar 50), `alert_class`, `device_name`, and `metadata` (jsonb) — there are NO `activity_type`/`source_data` columns. (The NinjaOne webhook handler and Tactical webhook/backfill reference those nonexistent columns — a pre-existing latent bug; do NOT copy that convention.)
- Alga alert severities are `'critical' | 'major' | 'moderate' | 'minor' | 'none'` (see `RmmAlertSeverity` in `ee/server/src/interfaces/rmm.interfaces.ts`). Level severities are `information | warning | critical | emergency`.
- `RmmSyncResult` (defined in `ee/server/src/interfaces/rmm.interfaces.ts:317`) is the result shape for all sync operations.
- The `@enterprise/*` alias is CE-first: it maps to `packages/ee/src/*` (stubs) and webpack overrides it to `ee/server/src/*` in EE builds. That's why EE features need a real file in `ee/server/src/...`, a stub in `packages/ee/src/...`, and (for API routes) a re-export in `server/src/app/...`.

---

### Task 1: Register the `levelio` provider key

**Files:**
- Modify: `packages/types/src/interfaces/asset.interfaces.ts:24`
- Modify: `ee/server/src/interfaces/rmm.interfaces.ts:9`
- Modify: `packages/assets/src/actions/inboundActions.ts` (KNOWN_RMM_PROVIDERS set, ~line 9)
- Modify: `packages/assets/src/lib/rmmProviderDisplay.ts`
- Test: `packages/types/src/interfaces/rmmProvider.typecheck.test.ts`

- [ ] **Step 1: Write the failing typecheck test**

Append inside the existing `describe('RmmProvider', ...)` block in `packages/types/src/interfaces/rmmProvider.typecheck.test.ts`:

```ts
  it('accepts levelio', () => {
    const provider: RmmProvider = 'levelio';
    expect(provider).toBe('levelio');

    const asset: Partial<Asset> = { rmm_provider: provider };
    expect(asset.rmm_provider).toBe('levelio');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/types && npx vitest run src/interfaces/rmmProvider.typecheck.test.ts`
Expected: FAIL — TS error `Type '"levelio"' is not assignable to type 'RmmProvider'` (vitest surfaces it as a transform/compile error).

- [ ] **Step 3: Add `'levelio'` to both RmmProvider unions**

In `packages/types/src/interfaces/asset.interfaces.ts` change:

```ts
export type RmmProvider = 'ninjaone' | 'tacticalrmm' | 'tanium' | 'levelio' | 'datto' | 'connectwise_automate';
```

In `ee/server/src/interfaces/rmm.interfaces.ts` change line 9 identically:

```ts
export type RmmProvider = 'ninjaone' | 'tacticalrmm' | 'tanium' | 'levelio' | 'datto' | 'connectwise_automate';
```

- [ ] **Step 4: Add to KNOWN_RMM_PROVIDERS and display names**

In `packages/assets/src/actions/inboundActions.ts`:

```ts
const KNOWN_RMM_PROVIDERS = new Set<RmmProvider>([
  'ninjaone',
  'tacticalrmm',
  'tanium',
  'levelio',
  'datto',
  'connectwise_automate',
]);
```

In `packages/assets/src/lib/rmmProviderDisplay.ts`, add a case before `default`:

```ts
    case 'levelio':
      return 'Level';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/types && npx vitest run src/interfaces/rmmProvider.typecheck.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/interfaces/asset.interfaces.ts ee/server/src/interfaces/rmm.interfaces.ts packages/assets/src/actions/inboundActions.ts packages/assets/src/lib/rmmProviderDisplay.ts packages/types/src/interfaces/rmmProvider.typecheck.test.ts
git commit -m "feat(rmm): register levelio provider key in type unions and display maps"
```

Note: the `WorkflowDesigner.tsx` icon switch is intentionally NOT touched — it keys on workflow action group tokens (Level adds no workflow actions), not RMM provider keys.

---

### Task 2: Level API client

**Files:**
- Create: `ee/server/src/lib/integrations/levelio/levelApiClient.ts`
- Test: `ee/server/src/__tests__/unit/integrations/levelApiClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `ee/server/src/__tests__/unit/integrations/levelApiClient.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  LevelIoApiClient,
  LevelIoApiError,
} from '../../../lib/integrations/levelio/levelApiClient';

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

describe('LevelIoApiClient', () => {
  it('sends the API key in the Authorization header and device include flags', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [], has_more: false }));
    const client = new LevelIoApiClient({ apiKey: 'lvl-key', fetchImpl: fetchMock as unknown as typeof fetch });

    await client.listDevices();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://api.level.io/v2/devices');
    expect(url).toContain('include_operating_system=true');
    expect(url).toContain('include_security=true');
    expect(url).toContain('limit=100');
    expect((options.headers as Record<string, string>).Authorization).toBe('lvl-key');
  });

  it('paginates with starting_after until has_more is false', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'dev-1' }, { id: 'dev-2' }], has_more: true }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'dev-3' }], has_more: false }));
    const client = new LevelIoApiClient({ apiKey: 'lvl-key', fetchImpl: fetchMock as unknown as typeof fetch });

    const devices = await client.listDevices();

    expect(devices.map((d) => d.id)).toEqual(['dev-1', 'dev-2', 'dev-3']);
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain('starting_after=dev-2');
  });

  it('throws an actionable error on 401', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, { status: 401 }));
    const client = new LevelIoApiClient({ apiKey: 'bad-key', fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.testConnection()).rejects.toThrow(/API key/);
    await expect(client.testConnection()).rejects.toBeInstanceOf(LevelIoApiError);
  });

  it('retries once on 429 honoring Retry-After', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'g-1', name: 'Group 1' }], has_more: false }));
    const client = new LevelIoApiClient({ apiKey: 'lvl-key', fetchImpl: fetchMock as unknown as typeof fetch });

    const groups = await client.listGroups();

    expect(groups).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on non-JSON responses', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>login</html>', { status: 200 }));
    const client = new LevelIoApiClient({ apiKey: 'lvl-key', fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.listGroups()).rejects.toThrow(/non-JSON/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelApiClient.test.ts`
Expected: FAIL — cannot resolve `../../../lib/integrations/levelio/levelApiClient`

- [ ] **Step 3: Implement the client**

Create `ee/server/src/lib/integrations/levelio/levelApiClient.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelApiClient.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/levelio/levelApiClient.ts ee/server/src/__tests__/unit/integrations/levelApiClient.test.ts
git commit -m "feat(levelio): add Level v2 REST API client with cursor pagination and retry"
```

---

### Task 3: Device mapper and group resolution

**Files:**
- Create: `ee/server/src/lib/integrations/levelio/mappers/deviceMapper.ts`
- Test: `ee/server/src/__tests__/unit/integrations/levelioDeviceMapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `ee/server/src/__tests__/unit/integrations/levelioDeviceMapper.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGroupParentMap,
  buildGroupPath,
  extractLanIp,
  mapLevelIoDeviceToSnapshot,
  mapLevelIoDiskUsage,
  mapLevelIoSeverity,
  resolveDeepestMappedGroup,
} from '../../../lib/integrations/levelio/mappers/deviceMapper';
import type { LevelIoDevice, LevelIoGroup } from '../../../lib/integrations/levelio/levelApiClient';

const GROUPS: LevelIoGroup[] = [
  { id: 'g-root', parent_id: null, name: 'Acme Corp' },
  { id: 'g-site', parent_id: 'g-root', name: 'Branch Office' },
  { id: 'g-other', parent_id: null, name: 'Other MSP Client' },
];

function makeDevice(overrides: Partial<LevelIoDevice> = {}): LevelIoDevice {
  return {
    id: 'dev-1',
    hostname: 'WS-01',
    online: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mapLevelIoSeverity', () => {
  it('maps Level severities onto Alga severities', () => {
    expect(mapLevelIoSeverity('emergency')).toBe('critical');
    expect(mapLevelIoSeverity('critical')).toBe('major');
    expect(mapLevelIoSeverity('warning')).toBe('moderate');
    expect(mapLevelIoSeverity('information')).toBe('minor');
    expect(mapLevelIoSeverity('something-else')).toBe('none');
    expect(mapLevelIoSeverity(undefined)).toBe('none');
  });
});

describe('resolveDeepestMappedGroup', () => {
  const parentMap = buildGroupParentMap(GROUPS);

  it('prefers the device group itself when mapped', () => {
    expect(resolveDeepestMappedGroup('g-site', parentMap, new Set(['g-root', 'g-site']))).toBe('g-site');
  });

  it('walks up to the nearest mapped ancestor', () => {
    expect(resolveDeepestMappedGroup('g-site', parentMap, new Set(['g-root']))).toBe('g-root');
  });

  it('returns null when no ancestor is mapped', () => {
    expect(resolveDeepestMappedGroup('g-site', parentMap, new Set(['g-other']))).toBeNull();
    expect(resolveDeepestMappedGroup(null, parentMap, new Set(['g-root']))).toBeNull();
  });

  it('is safe against parent cycles', () => {
    const cyclic = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(resolveDeepestMappedGroup('a', cyclic, new Set(['zzz']))).toBeNull();
  });
});

describe('buildGroupPath', () => {
  it('renders the ancestor chain as a path', () => {
    const groupsById = new Map(GROUPS.map((g) => [g.id, g]));
    expect(buildGroupPath('g-site', groupsById)).toBe('Acme Corp / Branch Office');
    expect(buildGroupPath('g-root', groupsById)).toBe('Acme Corp');
  });
});

describe('extractLanIp', () => {
  it('skips virtual adapters and public IPs, returns the first private IPv4', () => {
    expect(
      extractLanIp([
        { description: 'Microsoft Wi-Fi Direct Virtual Adapter', ip_addresses: ['192.168.0.9'] },
        { description: 'Intel Ethernet', ip_addresses: ['8.8.8.8', '10.1.2.3'] },
      ])
    ).toBe('10.1.2.3');
    expect(extractLanIp([])).toBeNull();
    expect(extractLanIp(undefined)).toBeNull();
  });
});

describe('mapLevelIoDiskUsage', () => {
  it('converts partitions to RmmStorageInfo in GB with utilization', () => {
    const device = makeDevice({
      disk_partitions: [
        { mount_point: 'C:', size: 100 * 1024 ** 3, free_space: 25 * 1024 ** 3 },
        { label: 'no-size partition' },
      ],
    });

    expect(mapLevelIoDiskUsage(device)).toEqual([
      { name: 'C:', total_gb: 100, free_gb: 25, utilization_percent: 75 },
    ]);
  });
});

describe('mapLevelIoDeviceToSnapshot', () => {
  it('maps servers and domain controllers to server assets, everything else to workstations', () => {
    const base = { integrationId: 'int-1', scopeId: 'g-root' };
    expect(mapLevelIoDeviceToSnapshot({ ...base, device: makeDevice({ role: 'server' }) }).assetType).toBe('server');
    expect(mapLevelIoDeviceToSnapshot({ ...base, device: makeDevice({ role: 'domain_controller' }) }).assetType).toBe('server');
    expect(mapLevelIoDeviceToSnapshot({ ...base, device: makeDevice({ role: 'workstation' }) }).assetType).toBe('workstation');
    expect(mapLevelIoDeviceToSnapshot({ ...base, device: makeDevice({ role: null }) }).assetType).toBe('workstation');
  });

  it('maps identity, status, uptime, and cached live data', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));

    const device = makeDevice({
      nickname: 'Front Desk',
      serial_number: 'SN-123',
      online: true,
      last_seen_at: '2026-01-02T00:00:00.000Z',
      last_reboot_time: '2026-01-01T00:00:00.000Z',
      last_logged_in_user: 'jdoe',
      platform: 'Windows',
      operating_system: { full_operating_system: 'Windows 11', minor_version: '10.0.22631.3007' },
      total_memory: 16 * 1024 ** 3,
      cpu_cores: 8,
      cpus: [{ model: 'Intel i7', cores: 8 }],
      city: 'Asheville',
      country: 'United States',
      security: { antivirus_provider: 'Defender', antivirus_status: 'good', score: 90 },
    });

    const snapshot = mapLevelIoDeviceToSnapshot({
      integrationId: 'int-1',
      device,
      scopeId: 'g-root',
      pendingOsPatches: 4,
    });

    expect(snapshot.provider).toBe('levelio');
    expect(snapshot.externalDeviceId).toBe('dev-1');
    expect(snapshot.externalScopeId).toBe('g-root');
    expect(snapshot.displayName).toBe('Front Desk');
    expect(snapshot.serialNumber).toBe('SN-123');
    expect(snapshot.agentStatus).toBe('online');
    expect(snapshot.lifecycleState).toBe('active');
    expect(snapshot.location).toBe('Asheville, United States');
    expect(snapshot.assetTag).toBe('levelio:dev-1');
    expect(snapshot.extension?.uptimeSeconds).toBe(86400);
    expect(snapshot.extension?.osType).toBe('Windows');
    expect(snapshot.extension?.osVersion).toBe('10.0.22631.3007');
    expect(snapshot.extension?.currentUser).toBe('jdoe');
    expect(snapshot.extension?.cpuModel).toBe('Intel i7');
    expect(snapshot.extension?.cpuCores).toBe(8);
    expect(snapshot.extension?.ramGb).toBe(16);
    expect(snapshot.extension?.pendingOsPatches).toBe(4);
    expect(snapshot.extension?.antivirusProduct).toBe('Defender');
  });

  it('marks offline devices offline with no uptime', () => {
    const snapshot = mapLevelIoDeviceToSnapshot({
      integrationId: 'int-1',
      device: makeDevice({ online: false, last_reboot_time: '2026-01-01T00:00:00.000Z' }),
      scopeId: 'g-root',
    });

    expect(snapshot.agentStatus).toBe('offline');
    expect(snapshot.lifecycleState).toBe('offline');
    expect(snapshot.status).toBe('inactive');
    expect(snapshot.extension?.uptimeSeconds).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelioDeviceMapper.test.ts`
Expected: FAIL — cannot resolve the mapper module

- [ ] **Step 3: Implement the mapper**

Create `ee/server/src/lib/integrations/levelio/mappers/deviceMapper.ts`:

```ts
import type { RmmStorageInfo } from '@alga-psa/types';
import type { NormalizedRmmExternalDeviceSnapshot } from '@alga-psa/shared/rmm/contracts';
import type { RmmAlertSeverity } from '../../../../interfaces/rmm.interfaces';
import type { LevelIoDevice, LevelIoGroup, LevelIoNetworkInterface } from '../levelApiClient';

const PROVIDER = 'levelio' as const;
const BYTES_PER_GB = 1024 ** 3;
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mapLevelIoSeverity(input: unknown): RmmAlertSeverity {
  switch (String(input || '').toLowerCase()) {
    case 'emergency':
      return 'critical';
    case 'critical':
      return 'major';
    case 'warning':
      return 'moderate';
    case 'information':
      return 'minor';
    default:
      return 'none';
  }
}

export function buildGroupParentMap(groups: LevelIoGroup[]): Map<string, string | null> {
  return new Map(groups.map((group) => [group.id, group.parent_id ?? null]));
}

/**
 * Walks from the device's group up the hierarchy and returns the first
 * (i.e. deepest) group that has a client mapping. Deterministic when both a
 * parent and a child group are mapped.
 */
export function resolveDeepestMappedGroup(
  groupId: string | null | undefined,
  parentByGroupId: Map<string, string | null>,
  mappedGroupIds: Set<string>
): string | null {
  let current = groupId ?? null;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (mappedGroupIds.has(current)) {
      return current;
    }
    visited.add(current);
    current = parentByGroupId.get(current) ?? null;
  }
  return null;
}

export function buildGroupPath(groupId: string, groupsById: Map<string, LevelIoGroup>): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let current: string | null = groupId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const group = groupsById.get(current);
    if (!group) break;
    names.unshift(group.name);
    current = group.parent_id ?? null;
  }
  return names.join(' / ');
}

export function extractLanIp(interfaces?: LevelIoNetworkInterface[] | null): string | null {
  for (const iface of interfaces ?? []) {
    if ((iface.description || '').toLowerCase().includes('virtual')) continue;
    for (const ip of iface.ip_addresses ?? []) {
      if (PRIVATE_IPV4.test(ip)) {
        return ip;
      }
    }
  }
  return null;
}

export function mapLevelIoDiskUsage(device: LevelIoDevice): RmmStorageInfo[] {
  return (device.disk_partitions ?? [])
    .filter((partition) => typeof partition.size === 'number' && partition.size > 0)
    .map((partition) => {
      const totalGb = roundTo2((partition.size as number) / BYTES_PER_GB);
      const freeGb = typeof partition.free_space === 'number' ? roundTo2(partition.free_space / BYTES_PER_GB) : 0;
      const utilization = totalGb > 0 ? roundTo2(((totalGb - freeGb) / totalGb) * 100) : 0;
      return {
        name: partition.mount_point || partition.label || 'disk',
        total_gb: totalGb,
        free_gb: freeGb,
        utilization_percent: utilization,
      };
    });
}

export function mapLevelIoDeviceToSnapshot(args: {
  integrationId: string;
  device: LevelIoDevice;
  scopeId: string;
  pendingOsPatches?: number | null;
}): NormalizedRmmExternalDeviceSnapshot {
  const { device } = args;
  const isOnline = device.online === true;
  const uptimeSeconds = isOnline && device.last_reboot_time
    ? Math.max(0, Math.floor((Date.now() - new Date(device.last_reboot_time).getTime()) / 1000))
    : null;
  const cpu = device.cpus?.[0];
  const location = [device.city, device.country].filter(Boolean).join(', ') || null;

  return {
    provider: PROVIDER,
    integrationId: args.integrationId,
    externalDeviceId: device.id,
    externalScopeId: args.scopeId,
    lifecycleState: isOnline ? 'active' : 'offline',
    assetType: device.role === 'server' || device.role === 'domain_controller' ? 'server' : 'workstation',
    displayName: device.nickname || device.hostname || device.id,
    serialNumber: device.serial_number ?? null,
    status: isOnline ? 'active' : 'inactive',
    location,
    assetTag: `levelio:${device.id}`,
    agentStatus: isOnline ? 'online' : 'offline',
    lastSeenAt: device.last_seen_at ?? null,
    extension: {
      osType: device.platform ?? null,
      osVersion:
        device.operating_system?.minor_version ??
        device.operating_system?.major_version ??
        device.operating_system?.full_operating_system ??
        null,
      currentUser: device.last_logged_in_user ?? null,
      uptimeSeconds,
      lanIp: extractLanIp(device.network_interfaces),
      wanIp: null,
      antivirusStatus: device.security?.antivirus_status ?? null,
      antivirusProduct: device.security?.antivirus_provider ?? null,
      lastRebootAt: device.last_reboot_time ?? null,
      pendingOsPatches: args.pendingOsPatches ?? null,
      cpuModel: cpu?.model ?? null,
      cpuCores: device.cpu_cores ?? cpu?.cores ?? null,
      ramGb: typeof device.total_memory === 'number' ? roundTo2(device.total_memory / BYTES_PER_GB) : null,
      diskUsage: mapLevelIoDiskUsage(device),
      systemInfo: {
        manufacturer: device.manufacturer ?? null,
        model: device.model ?? null,
        fullOperatingSystem: device.operating_system?.full_operating_system ?? null,
        securityScore: device.security?.score ?? device.security_score ?? null,
        securityRisk: device.security?.risk ?? null,
        patchSecurityRisk: device.security?.patch_security_risk ?? null,
        maintenanceMode: Boolean(device.maintenance_mode),
        flag: device.flag ?? null,
        tags: device.tags ?? [],
        groupId: device.group_id ?? null,
      },
    },
    metadata: {
      hostname: device.hostname,
      groupId: device.group_id ?? null,
      tags: device.tags ?? [],
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelioDeviceMapper.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/levelio/mappers/deviceMapper.ts ee/server/src/__tests__/unit/integrations/levelioDeviceMapper.test.ts
git commit -m "feat(levelio): add device mapper, severity mapping, and deepest-mapped-group resolution"
```

---

### Task 4: Sync engine

**Files:**
- Create: `ee/server/src/lib/integrations/levelio/sync/syncEngine.ts`
- Test: `ee/server/src/__tests__/unit/integrations/levelioSyncEngine.test.ts`

The engine is the single source of truth for sync logic, called by both the direct transport (server actions) and Temporal activities. Dependencies (knex, API client, ingest function, event publisher) are injected so tests need no module mocks.

- [ ] **Step 1: Write the failing tests**

Create `ee/server/src/__tests__/unit/integrations/levelioSyncEngine.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  runLevelIoAlertsBackfill,
  runLevelIoFullSync,
} from '../../../lib/integrations/levelio/sync/syncEngine';
import type { LevelIoApiClient } from '../../../lib/integrations/levelio/levelApiClient';

type RowsByTable = Record<string, any[]>;

function createKnexStub(rowsByTable: RowsByTable) {
  const inserted: Record<string, any[]> = {};
  const knex: any = (table: string) => {
    const rows = rowsByTable[table] ?? [];
    const builder: any = {
      where: () => builder,
      whereNotNull: () => builder,
      andWhere: () => builder,
      whereIn: () => builder,
      select: async () => rows,
      first: async () => rows[0],
      update: async () => 1,
      insert: async (row: any) => {
        inserted[table] = inserted[table] ?? [];
        inserted[table].push(row);
        return [1];
      },
    };
    return builder;
  };
  knex.fn = { now: () => new Date() };
  knex._inserted = inserted;
  return knex;
}

const GROUPS = [
  { id: 'g-root', parent_id: null, name: 'Acme Corp' },
  { id: 'g-site', parent_id: 'g-root', name: 'Branch Office' },
];

describe('runLevelIoFullSync', () => {
  it('assigns devices to the deepest mapped ancestor, attaches patch counts, skips unmapped devices', async () => {
    const knex = createKnexStub({
      rmm_organization_mappings: [{ external_organization_id: 'g-root', client_id: 'client-1' }],
    });

    const client = {
      listGroups: vi.fn(async () => GROUPS),
      listDevices: vi.fn(async () => [
        { id: 'dev-1', hostname: 'WS-01', online: true, group_id: 'g-site' },
        { id: 'dev-2', hostname: 'WS-02', online: true, group_id: null },
      ]),
      listUpdates: vi.fn(async () => [
        { id: 'u-1', device_id: 'dev-1', device_hostname: 'WS-01', name: 'KB1', category: 'Security Updates', is_available: true },
        { id: 'u-2', device_id: 'dev-1', device_hostname: 'WS-01', name: 'KB2', category: 'Security Updates', is_available: true },
      ]),
    } as unknown as LevelIoApiClient;

    const ingest = vi.fn(async () => ({ externalDeviceId: 'dev-1', action: 'created' as const, assetId: 'asset-1' }));
    const publishEvent = vi.fn(async () => undefined);

    const result = await runLevelIoFullSync(
      { tenant: 'tenant-1', integrationId: 'int-1' },
      { knex, client, ingest, publishEvent }
    );

    expect(ingest).toHaveBeenCalledTimes(1);
    const ingestInput = ingest.mock.calls[0][0] as any;
    expect(ingestInput.snapshot.externalDeviceId).toBe('dev-1');
    expect(ingestInput.snapshot.externalScopeId).toBe('g-root');
    expect(ingestInput.snapshot.extension.pendingOsPatches).toBe(2);
    expect(ingestInput.resolvedClientId).toBe('client-1');

    expect(result.success).toBe(true);
    expect(result.sync_type).toBe('full');
    expect(result.items_processed).toBe(1);
    expect(result.items_created).toBe(1);
    expect(result.items_failed).toBe(0);

    const eventNames = publishEvent.mock.calls.map((call) => (call[0] as any).event_name);
    expect(eventNames).toEqual(['RMM_SYNC_STARTED', 'RMM_SYNC_COMPLETED']);
  });

  it('counts per-device ingestion failures without aborting and emits a completed event', async () => {
    const knex = createKnexStub({
      rmm_organization_mappings: [{ external_organization_id: 'g-root', client_id: 'client-1' }],
    });
    const client = {
      listGroups: vi.fn(async () => GROUPS),
      listDevices: vi.fn(async () => [
        { id: 'dev-1', hostname: 'WS-01', online: true, group_id: 'g-root' },
        { id: 'dev-2', hostname: 'WS-02', online: true, group_id: 'g-root' },
      ]),
      listUpdates: vi.fn(async () => []),
    } as unknown as LevelIoApiClient;

    const ingest = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ externalDeviceId: 'dev-2', action: 'updated' });

    const result = await runLevelIoFullSync(
      { tenant: 'tenant-1', integrationId: 'int-1' },
      { knex, client, ingest, publishEvent: vi.fn(async () => undefined) }
    );

    expect(result.success).toBe(false);
    expect(result.items_processed).toBe(2);
    expect(result.items_updated).toBe(1);
    expect(result.items_failed).toBe(1);
    expect(result.errors?.[0]).toContain('dev-1');
  });
});

describe('runLevelIoAlertsBackfill', () => {
  it('upserts active and resolved alerts with mapped severities and asset linkage', async () => {
    const knex = createKnexStub({
      tenant_external_entity_mappings: [{ external_entity_id: 'dev-1', alga_entity_id: 'asset-1' }],
      rmm_alerts: [],
    });

    const client = {
      listAlerts: vi.fn(async (params: { status: string }) =>
        params.status === 'active'
          ? [{
              id: 'al-1', device_id: 'dev-1', device_hostname: 'WS-01', name: 'Low disk',
              description: 'Disk free < 5%', severity: 'emergency', is_resolved: false,
              started_at: '2026-01-01T00:00:00.000Z',
            }]
          : [{
              id: 'al-2', device_id: 'dev-9', device_hostname: 'WS-09', name: 'CPU',
              description: 'High CPU', severity: 'warning', is_resolved: true,
              started_at: '2026-01-01T00:00:00.000Z', resolved_at: '2026-01-01T01:00:00.000Z',
            }]
      ),
    } as unknown as LevelIoApiClient;

    const result = await runLevelIoAlertsBackfill(
      { tenant: 'tenant-1', integrationId: 'int-1' },
      { knex, client, publishEvent: vi.fn(async () => undefined) }
    );

    expect(result.success).toBe(true);
    expect(result.sync_type).toBe('alerts');
    expect(result.items_processed).toBe(2);
    expect(result.items_created).toBe(2);

    const insertedAlerts = knex._inserted.rmm_alerts;
    expect(insertedAlerts).toHaveLength(2);
    expect(insertedAlerts[0].severity).toBe('critical');
    expect(insertedAlerts[0].asset_id).toBe('asset-1');
    expect(insertedAlerts[0].status).toBe('active');
    expect(insertedAlerts[0].source_type).toBe('levelio_alert');
    expect(insertedAlerts[0].device_name).toBe('WS-01');
    expect(insertedAlerts[0].metadata.id).toBe('al-1');
    expect(insertedAlerts[1].severity).toBe('moderate');
    expect(insertedAlerts[1].asset_id).toBeNull();
    expect(insertedAlerts[1].status).toBe('resolved');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelioSyncEngine.test.ts`
Expected: FAIL — cannot resolve the syncEngine module

- [ ] **Step 3: Implement the engine**

Create `ee/server/src/lib/integrations/levelio/sync/syncEngine.ts`:

```ts
/**
 * Level.io sync engine — the single source of truth for sync logic.
 * Called by both the direct transport (server actions) and Temporal
 * activities; all I/O dependencies are injected via LevelIoSyncDeps.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getRedisStreamClient } from '@alga-psa/workflow-streams';
import { ingestNormalizedRmmDeviceSnapshot } from '@alga-psa/shared/rmm/sharedAssetIngestionService';
import type { NormalizedRmmIngestionResult } from '@alga-psa/shared/rmm/contracts';
import type { RmmSyncResult } from '../../../../interfaces/rmm.interfaces';
import type { LevelIoApiClient, LevelIoAlert } from '../levelApiClient';
import {
  buildGroupParentMap,
  buildGroupPath,
  mapLevelIoDeviceToSnapshot,
  mapLevelIoSeverity,
  resolveDeepestMappedGroup,
} from '../mappers/deviceMapper';

const PROVIDER = 'levelio' as const;

type LevelIoSyncEventName = 'RMM_SYNC_STARTED' | 'RMM_SYNC_COMPLETED' | 'RMM_SYNC_FAILED';

export interface LevelIoSyncDeps {
  knex: Knex;
  client: LevelIoApiClient;
  ingest?: typeof ingestNormalizedRmmDeviceSnapshot;
  publishEvent?: (event: Record<string, unknown>) => Promise<void>;
}

export interface LevelIoSyncArgs {
  tenant: string;
  integrationId: string;
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function emitSyncEvent(
  deps: LevelIoSyncDeps,
  args: { eventName: LevelIoSyncEventName; tenant: string; payload: Record<string, unknown> }
): Promise<void> {
  const publish =
    deps.publishEvent ??
    (async (event: Record<string, unknown>) => {
      await getRedisStreamClient().publishEvent(event as never);
    });

  try {
    await publish({
      event_id: randomUUID(),
      event_name: args.eventName,
      event_type: args.eventName,
      tenant: args.tenant,
      timestamp: new Date().toISOString(),
      payload: args.payload,
    });
  } catch {
    // Event emission is best-effort.
  }
}

async function setSyncStatus(knex: Knex, tenant: string, patch: Record<string, unknown>): Promise<void> {
  await knex('rmm_integrations')
    .where({ tenant, provider: PROVIDER })
    .update({ ...patch, updated_at: knex.fn.now() });
}

export async function runLevelIoScopeSync(args: LevelIoSyncArgs, deps: LevelIoSyncDeps): Promise<RmmSyncResult> {
  const startedAt = new Date().toISOString();
  await emitSyncEvent(deps, {
    eventName: 'RMM_SYNC_STARTED',
    tenant: args.tenant,
    payload: { integration_id: args.integrationId, provider: PROVIDER, sync_type: 'organizations', started_at: startedAt },
  });

  try {
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'syncing', sync_error: null });

    const groups = await deps.client.listGroups();
    const groupsById = new Map(groups.map((group) => [group.id, group]));

    const existing = await deps.knex('rmm_organization_mappings')
      .where({ tenant: args.tenant, integration_id: args.integrationId })
      .select(['mapping_id', 'external_organization_id']);
    const byExternalId = new Map(existing.map((row: any) => [String(row.external_organization_id), row]));

    let created = 0;
    let updated = 0;
    for (const group of groups) {
      const metadata = {
        kind: 'group',
        parentId: group.parent_id ?? null,
        path: buildGroupPath(group.id, groupsById),
      };
      const prior = byExternalId.get(group.id);
      if (prior) {
        await deps.knex('rmm_organization_mappings')
          .where({ tenant: args.tenant, mapping_id: prior.mapping_id })
          .update({
            external_organization_name: group.name,
            metadata,
            last_synced_at: deps.knex.fn.now(),
            updated_at: deps.knex.fn.now(),
          });
        updated += 1;
      } else {
        await deps.knex('rmm_organization_mappings').insert({
          tenant: args.tenant,
          integration_id: args.integrationId,
          external_organization_id: group.id,
          external_organization_name: group.name,
          auto_sync_assets: true,
          auto_create_tickets: false,
          metadata,
          last_synced_at: deps.knex.fn.now(),
          created_at: deps.knex.fn.now(),
          updated_at: deps.knex.fn.now(),
        });
        created += 1;
      }
    }

    await setSyncStatus(deps.knex, args.tenant, {
      sync_status: 'completed',
      last_sync_at: deps.knex.fn.now(),
      sync_error: null,
    });

    const completedAt = new Date().toISOString();
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_COMPLETED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'organizations',
        items_processed: groups.length,
        items_created: created,
        items_updated: updated,
        items_failed: 0,
        completed_at: completedAt,
      },
    });

    return {
      success: true,
      provider: PROVIDER,
      sync_type: 'organizations',
      started_at: startedAt,
      completed_at: completedAt,
      items_processed: groups.length,
      items_created: created,
      items_updated: updated,
      items_failed: 0,
      errors: [],
    };
  } catch (error) {
    const message = sanitizeError(error);
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'error', sync_error: message }).catch(() => undefined);
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_FAILED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'organizations',
        error: message,
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}

export async function runLevelIoFullSync(args: LevelIoSyncArgs, deps: LevelIoSyncDeps): Promise<RmmSyncResult> {
  const startedAt = new Date().toISOString();
  const ingest = deps.ingest ?? ingestNormalizedRmmDeviceSnapshot;

  await emitSyncEvent(deps, {
    eventName: 'RMM_SYNC_STARTED',
    tenant: args.tenant,
    payload: { integration_id: args.integrationId, provider: PROVIDER, sync_type: 'full', started_at: startedAt },
  });

  try {
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'syncing', sync_error: null });

    const mappings = await deps.knex('rmm_organization_mappings')
      .where({ tenant: args.tenant, integration_id: args.integrationId })
      .whereNotNull('client_id')
      .andWhere('auto_sync_assets', true)
      .select(['external_organization_id', 'client_id']);

    const clientIdByGroupId = new Map<string, string>(
      mappings.map((row: any) => [String(row.external_organization_id), String(row.client_id)])
    );
    const mappedGroupIds = new Set(clientIdByGroupId.keys());

    const [groups, devices, availableUpdates] = await Promise.all([
      deps.client.listGroups(),
      deps.client.listDevices(),
      deps.client.listUpdates({ status: 'available' }),
    ]);

    const parentByGroupId = buildGroupParentMap(groups);
    const pendingOsPatchesByDeviceId = new Map<string, number>();
    for (const update of availableUpdates) {
      pendingOsPatchesByDeviceId.set(update.device_id, (pendingOsPatchesByDeviceId.get(update.device_id) ?? 0) + 1);
    }

    let processed = 0;
    let created = 0;
    let updated = 0;
    let skippedNoMapping = 0;
    const errors: string[] = [];

    for (const device of devices) {
      const scopeGroupId = resolveDeepestMappedGroup(device.group_id ?? null, parentByGroupId, mappedGroupIds);
      if (!scopeGroupId) {
        skippedNoMapping += 1;
        continue;
      }

      const snapshot = mapLevelIoDeviceToSnapshot({
        integrationId: args.integrationId,
        device,
        scopeId: scopeGroupId,
        pendingOsPatches: pendingOsPatchesByDeviceId.get(device.id) ?? 0,
      });

      try {
        const outcome = await ingest({
          tenant: args.tenant,
          snapshot,
          resolvedClientId: clientIdByGroupId.get(scopeGroupId) ?? null,
          knex: deps.knex,
        });
        processed += 1;
        if (outcome.action === 'created') created += 1;
        if (outcome.action === 'updated') updated += 1;
        if (outcome.action === 'failed' && outcome.error) {
          errors.push(`${device.id}: ${outcome.error}`);
        }
      } catch (error) {
        processed += 1;
        errors.push(`${device.id}: ${sanitizeError(error)}`);
      }
    }

    await setSyncStatus(deps.knex, args.tenant, {
      sync_status: errors.length ? 'error' : 'completed',
      last_sync_at: deps.knex.fn.now(),
      last_full_sync_at: deps.knex.fn.now(),
      sync_error: errors.length ? errors.slice(0, 10).join('; ') : null,
    });

    const completedAt = new Date().toISOString();
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_COMPLETED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'full',
        items_processed: processed,
        items_created: created,
        items_updated: updated,
        items_failed: errors.length,
        skipped_no_mapping: skippedNoMapping,
        completed_at: completedAt,
      },
    });

    return {
      success: errors.length === 0,
      provider: PROVIDER,
      sync_type: 'full',
      started_at: startedAt,
      completed_at: completedAt,
      items_processed: processed,
      items_created: created,
      items_updated: updated,
      items_failed: errors.length,
      errors,
    };
  } catch (error) {
    const message = sanitizeError(error);
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'error', sync_error: message }).catch(() => undefined);
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_FAILED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'full',
        error: message,
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}

export async function runLevelIoDeviceSync(
  args: LevelIoSyncArgs & { deviceId: string },
  deps: LevelIoSyncDeps
): Promise<NormalizedRmmIngestionResult> {
  const ingest = deps.ingest ?? ingestNormalizedRmmDeviceSnapshot;

  const [device, groups, mappings, availableUpdates] = await Promise.all([
    deps.client.getDevice(args.deviceId),
    deps.client.listGroups(),
    deps.knex('rmm_organization_mappings')
      .where({ tenant: args.tenant, integration_id: args.integrationId })
      .whereNotNull('client_id')
      .andWhere('auto_sync_assets', true)
      .select(['external_organization_id', 'client_id']),
    deps.client.listUpdates({ deviceId: args.deviceId, status: 'available' }),
  ]);

  const clientIdByGroupId = new Map<string, string>(
    mappings.map((row: any) => [String(row.external_organization_id), String(row.client_id)])
  );
  const scopeGroupId = resolveDeepestMappedGroup(
    device.group_id ?? null,
    buildGroupParentMap(groups),
    new Set(clientIdByGroupId.keys())
  );

  if (!scopeGroupId) {
    return {
      externalDeviceId: args.deviceId,
      action: 'skipped',
      error: 'Device has no mapped Level group ancestor',
    };
  }

  const snapshot = mapLevelIoDeviceToSnapshot({
    integrationId: args.integrationId,
    device,
    scopeId: scopeGroupId,
    pendingOsPatches: availableUpdates.length,
  });

  return ingest({
    tenant: args.tenant,
    snapshot,
    resolvedClientId: clientIdByGroupId.get(scopeGroupId) ?? null,
    knex: deps.knex,
  });
}

export async function runLevelIoAlertsBackfill(args: LevelIoSyncArgs, deps: LevelIoSyncDeps): Promise<RmmSyncResult> {
  const startedAt = new Date().toISOString();
  await emitSyncEvent(deps, {
    eventName: 'RMM_SYNC_STARTED',
    tenant: args.tenant,
    payload: { integration_id: args.integrationId, provider: PROVIDER, sync_type: 'alerts', started_at: startedAt },
  });

  try {
    const [active, resolved] = await Promise.all([
      deps.client.listAlerts({ status: 'active' }),
      deps.client.listAlerts({ status: 'resolved' }),
    ]);
    const alerts: LevelIoAlert[] = [...active, ...resolved];

    const deviceIds = Array.from(new Set(alerts.map((alert) => alert.device_id)));
    const mappingRows = deviceIds.length
      ? await deps.knex('tenant_external_entity_mappings')
          .where({ tenant: args.tenant, integration_type: PROVIDER, alga_entity_type: 'asset' })
          .whereIn('external_entity_id', deviceIds)
          .select(['external_entity_id', 'alga_entity_id'])
      : [];
    const assetIdByDeviceId = new Map(
      mappingRows.map((row: any) => [String(row.external_entity_id), String(row.alga_entity_id)])
    );

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const alert of alerts) {
      const row = {
        tenant: args.tenant,
        integration_id: args.integrationId,
        external_alert_id: alert.id,
        external_device_id: alert.device_id,
        asset_id: assetIdByDeviceId.get(alert.device_id) ?? null,
        severity: mapLevelIoSeverity(alert.severity),
        priority: null,
        source_type: 'levelio_alert',
        status: alert.is_resolved ? 'resolved' : 'active',
        message: alert.payload
          ? `${alert.name}: ${alert.description} (${alert.payload})`
          : `${alert.name}: ${alert.description}`,
        device_name: alert.device_hostname ?? null,
        metadata: alert,
        triggered_at: alert.started_at,
        resolved_at: alert.resolved_at ?? null,
        updated_at: deps.knex.fn.now(),
      };

      try {
        const existing = await deps.knex('rmm_alerts')
          .where({ tenant: args.tenant, integration_id: args.integrationId, external_alert_id: alert.id })
          .first(['alert_id']);
        if (existing?.alert_id) {
          await deps.knex('rmm_alerts').where({ tenant: args.tenant, alert_id: existing.alert_id }).update(row);
          updated += 1;
        } else {
          await deps.knex('rmm_alerts').insert({ ...row, created_at: deps.knex.fn.now() });
          created += 1;
        }
      } catch (error) {
        errors.push(`${alert.id}: ${sanitizeError(error)}`);
      }
    }

    await setSyncStatus(deps.knex, args.tenant, { last_sync_at: deps.knex.fn.now() });

    const completedAt = new Date().toISOString();
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_COMPLETED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'alerts',
        items_processed: alerts.length,
        items_created: created,
        items_updated: updated,
        items_failed: errors.length,
        completed_at: completedAt,
      },
    });

    return {
      success: errors.length === 0,
      provider: PROVIDER,
      sync_type: 'alerts',
      started_at: startedAt,
      completed_at: completedAt,
      items_processed: alerts.length,
      items_created: created,
      items_updated: updated,
      items_failed: errors.length,
      errors,
    };
  } catch (error) {
    const message = sanitizeError(error);
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'error', sync_error: message }).catch(() => undefined);
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_FAILED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'alerts',
        error: message,
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}
```

Note the test file imports `runLevelIoAlertsBackfill` — make sure the test's import line includes it (it does, in the import block at the top).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelioSyncEngine.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/levelio/sync/syncEngine.ts ee/server/src/__tests__/unit/integrations/levelioSyncEngine.test.ts
git commit -m "feat(levelio): add sync engine for scopes, devices, patches, and alerts"
```

---

### Task 5: Transport helper (Temporal-first resolution + workflow starters)

**Files:**
- Create: `ee/server/src/lib/integrations/levelio/sync/transport.ts`
- Test: `ee/server/src/__tests__/unit/integrations/levelioTransport.test.ts`

This module is separate from the actions file (which is `'use server'` and may only export async functions) so the webhook route can also use it.

- [ ] **Step 1: Write the failing test**

Create `ee/server/src/__tests__/unit/integrations/levelioTransport.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { levelIoTransportOverride } from '../../../lib/integrations/levelio/sync/transport';

describe('levelIoTransportOverride', () => {
  afterEach(() => {
    delete process.env.LEVELIO_SYNC_TRANSPORT;
    delete process.env.RMM_SYNC_TRANSPORT;
  });

  it('defaults to temporal (Temporal-first provider)', () => {
    expect(levelIoTransportOverride()).toBe('temporal');
  });

  it('honors the provider-specific env var first', () => {
    process.env.LEVELIO_SYNC_TRANSPORT = 'direct';
    process.env.RMM_SYNC_TRANSPORT = 'temporal';
    expect(levelIoTransportOverride()).toBe('direct');
  });

  it('falls back to the global env var', () => {
    process.env.RMM_SYNC_TRANSPORT = 'direct';
    expect(levelIoTransportOverride()).toBe('direct');
  });

  it('ignores invalid values', () => {
    process.env.LEVELIO_SYNC_TRANSPORT = 'banana';
    expect(levelIoTransportOverride()).toBe('temporal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelioTransport.test.ts`
Expected: FAIL — cannot resolve the transport module

- [ ] **Step 3: Implement the transport helper**

Create `ee/server/src/lib/integrations/levelio/sync/transport.ts`:

```ts
/**
 * Level.io sync transport helpers.
 *
 * Level is Temporal-first: unlike resolveRmmSyncTransport()'s global 'direct'
 * default, levelIoTransportOverride() defaults to 'temporal'. Env precedence
 * is preserved: LEVELIO_SYNC_TRANSPORT > RMM_SYNC_TRANSPORT > 'temporal'.
 */

import type { RmmSyncTransport } from '../../rmm/sync/syncOrchestration';
import type { RmmSyncResult } from '../../../../interfaces/rmm.interfaces';

export type LevelIoWorkflowSyncType = 'organizations' | 'full' | 'alerts';

export interface LevelIoDeviceSyncOutcome {
  externalDeviceId: string;
  action: 'created' | 'updated' | 'marked_deleted' | 'skipped' | 'failed';
  assetId?: string;
  error?: string;
}

export function levelIoTransportOverride(): RmmSyncTransport {
  const specific = process.env.LEVELIO_SYNC_TRANSPORT;
  if (specific === 'temporal' || specific === 'direct') {
    return specific;
  }
  const globalSetting = process.env.RMM_SYNC_TRANSPORT;
  if (globalSetting === 'temporal' || globalSetting === 'direct') {
    return globalSetting;
  }
  return 'temporal';
}

async function getTemporalClient() {
  const temporal = await import('@temporalio/client');
  const address = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const connection = await temporal.Connection.connect({ address });
  return new temporal.Client({ connection, namespace });
}

function getTaskQueue(): string {
  return process.env.TEMPORAL_JOB_TASK_QUEUE || 'alga-jobs';
}

export async function startLevelIoSyncWorkflow(args: {
  tenantId: string;
  integrationId: string;
  syncType: LevelIoWorkflowSyncType;
}): Promise<RmmSyncResult> {
  const client = await getTemporalClient();
  const handle = await client.workflow.start('levelIoSyncWorkflow', {
    taskQueue: getTaskQueue(),
    workflowId: `levelio:${args.syncType}:${args.tenantId}:${args.integrationId}:${Date.now()}`,
    args: [{ tenantId: args.tenantId, integrationId: args.integrationId, syncType: args.syncType }],
  });
  return await handle.result();
}

export async function startLevelIoDeviceSyncWorkflow(args: {
  tenantId: string;
  integrationId: string;
  deviceId: string;
  waitForResult: boolean;
}): Promise<LevelIoDeviceSyncOutcome | null> {
  const client = await getTemporalClient();
  const handle = await client.workflow.start('levelIoDeviceSyncWorkflow', {
    taskQueue: getTaskQueue(),
    workflowId: `levelio:device:${args.tenantId}:${args.deviceId}:${Date.now()}`,
    args: [{ tenantId: args.tenantId, integrationId: args.integrationId, deviceId: args.deviceId }],
  });
  if (!args.waitForResult) {
    return null;
  }
  return await handle.result();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/levelioTransport.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add ee/server/src/lib/integrations/levelio/sync/transport.ts ee/server/src/__tests__/unit/integrations/levelioTransport.test.ts
git commit -m "feat(levelio): add Temporal-first transport resolution and workflow starters"
```

---

### Task 6: Temporal workflow and activities

**Files:**
- Create: `ee/temporal-workflows/src/workflows/levelio-sync-workflow.ts`
- Create: `ee/temporal-workflows/src/activities/levelio-sync-activities.ts`
- Modify: `ee/temporal-workflows/src/workflows/non-authored-index.ts`
- Modify: `ee/temporal-workflows/src/activities/non-authored-index.ts`

No new unit tests here: the workflow is a thin switch over activities and the activities are thin wrappers over the engine (tested in Task 4). Verification is by typecheck/build.

- [ ] **Step 1: Create the workflow**

Create `ee/temporal-workflows/src/workflows/levelio-sync-workflow.ts`:

```ts
import { proxyActivities, log } from '@temporalio/workflow';

import type { RmmSyncResult } from '@ee/interfaces/rmm.interfaces';

export type LevelIoSyncType = 'organizations' | 'full' | 'alerts';

export interface LevelIoSyncInput {
  tenantId: string;
  integrationId: string;
  syncType: LevelIoSyncType;
}

export interface LevelIoDeviceSyncInput {
  tenantId: string;
  integrationId: string;
  deviceId: string;
}

export interface LevelIoDeviceSyncResult {
  externalDeviceId: string;
  action: 'created' | 'updated' | 'marked_deleted' | 'skipped' | 'failed';
  assetId?: string;
  error?: string;
}

const activities = proxyActivities<{
  syncLevelIoOrganizationsActivity(input: { tenantId: string; integrationId: string }): Promise<RmmSyncResult>;
  syncLevelIoDevicesFullActivity(input: { tenantId: string; integrationId: string }): Promise<RmmSyncResult>;
  backfillLevelIoAlertsActivity(input: { tenantId: string; integrationId: string }): Promise<RmmSyncResult>;
  syncLevelIoDeviceActivity(input: LevelIoDeviceSyncInput): Promise<LevelIoDeviceSyncResult>;
}>({
  startToCloseTimeout: '1h',
  heartbeatTimeout: '2m', // If the worker dies, the activity is retried within 2 minutes
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2.0,
    initialInterval: '5s',
    maximumInterval: '1m',
  },
});

export async function levelIoSyncWorkflow(input: LevelIoSyncInput): Promise<RmmSyncResult> {
  const { tenantId, integrationId, syncType } = input;

  log.info('Starting Level.io sync workflow', { tenantId, integrationId, syncType });

  switch (syncType) {
    case 'organizations':
      return await activities.syncLevelIoOrganizationsActivity({ tenantId, integrationId });
    case 'full':
      return await activities.syncLevelIoDevicesFullActivity({ tenantId, integrationId });
    case 'alerts':
      return await activities.backfillLevelIoAlertsActivity({ tenantId, integrationId });
    default:
      throw new Error(`Unsupported Level.io sync type: ${syncType}`);
  }
}

export async function levelIoDeviceSyncWorkflow(input: LevelIoDeviceSyncInput): Promise<LevelIoDeviceSyncResult> {
  log.info('Starting Level.io device sync workflow', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    deviceId: input.deviceId,
  });

  return await activities.syncLevelIoDeviceActivity(input);
}
```

- [ ] **Step 2: Create the activities**

Create `ee/temporal-workflows/src/activities/levelio-sync-activities.ts`:

```ts
import { heartbeat } from '@temporalio/activity';

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin.js';

import { createLevelIoClient } from '@ee/lib/integrations/levelio/levelApiClient';
import {
  runLevelIoAlertsBackfill,
  runLevelIoDeviceSync,
  runLevelIoFullSync,
  runLevelIoScopeSync,
  type LevelIoSyncDeps,
} from '@ee/lib/integrations/levelio/sync/syncEngine';
import type { RmmSyncResult } from '@ee/interfaces/rmm.interfaces';

interface LevelIoActivityInput {
  tenantId: string;
  integrationId: string;
}

async function buildDeps(tenantId: string): Promise<LevelIoSyncDeps> {
  const [knex, client] = await Promise.all([getAdminConnection(), createLevelIoClient(tenantId)]);
  return { knex, client };
}

async function withHeartbeat<T>(run: () => Promise<T>): Promise<T> {
  const interval = setInterval(() => {
    try {
      heartbeat();
    } catch {
      // heartbeat() throws outside an activity context; ignore.
    }
  }, 30_000);

  try {
    return await run();
  } finally {
    clearInterval(interval);
  }
}

export async function syncLevelIoOrganizationsActivity(input: LevelIoActivityInput): Promise<RmmSyncResult> {
  logger.info('[LevelIo] organizations sync activity started', { tenantId: input.tenantId });
  const deps = await buildDeps(input.tenantId);
  return withHeartbeat(() =>
    runLevelIoScopeSync({ tenant: input.tenantId, integrationId: input.integrationId }, deps)
  );
}

export async function syncLevelIoDevicesFullActivity(input: LevelIoActivityInput): Promise<RmmSyncResult> {
  logger.info('[LevelIo] full device sync activity started', { tenantId: input.tenantId });
  const deps = await buildDeps(input.tenantId);
  return withHeartbeat(() =>
    runLevelIoFullSync({ tenant: input.tenantId, integrationId: input.integrationId }, deps)
  );
}

export async function backfillLevelIoAlertsActivity(input: LevelIoActivityInput): Promise<RmmSyncResult> {
  logger.info('[LevelIo] alerts backfill activity started', { tenantId: input.tenantId });
  const deps = await buildDeps(input.tenantId);
  return withHeartbeat(() =>
    runLevelIoAlertsBackfill({ tenant: input.tenantId, integrationId: input.integrationId }, deps)
  );
}

export async function syncLevelIoDeviceActivity(input: LevelIoActivityInput & { deviceId: string }) {
  logger.info('[LevelIo] single device sync activity started', {
    tenantId: input.tenantId,
    deviceId: input.deviceId,
  });
  const deps = await buildDeps(input.tenantId);
  return withHeartbeat(() =>
    runLevelIoDeviceSync(
      { tenant: input.tenantId, integrationId: input.integrationId, deviceId: input.deviceId },
      deps
    )
  );
}
```

- [ ] **Step 3: Register the workflow and activities**

In `ee/temporal-workflows/src/workflows/non-authored-index.ts`, after the line `export * from './ninjaone-token-refresh-workflow.js';` add:

```ts
export * from './levelio-sync-workflow.js';
```

In `ee/temporal-workflows/src/activities/non-authored-index.ts`, after the line `export * from './ninjaone-token-refresh-activities';` add:

```ts
export * from './levelio-sync-activities';
```

- [ ] **Step 4: Typecheck the worker package**

Run: `cd ee/temporal-workflows && npx tsc --noEmit`
Expected: no NEW errors mentioning `levelio` (if the baseline has pre-existing errors, compare against `git stash`-free main behavior; the new files must not add errors).

- [ ] **Step 5: Commit**

```bash
git add ee/temporal-workflows/src/workflows/levelio-sync-workflow.ts ee/temporal-workflows/src/activities/levelio-sync-activities.ts ee/temporal-workflows/src/workflows/non-authored-index.ts ee/temporal-workflows/src/activities/non-authored-index.ts
git commit -m "feat(levelio): add Temporal sync workflow and activities"
```

---

### Task 7: Server actions

**Files:**
- Create: `ee/server/src/lib/actions/integrations/levelIoActions.ts`

No new unit tests: actions are thin wrappers of permission checks + engine/transport calls (matching `taniumActions.ts`, which is verified via UI tests and the engine tests above). Verification is by typecheck and the UI in Task 9.

- [ ] **Step 1: Create the actions file**

Create `ee/server/src/lib/actions/integrations/levelIoActions.ts`:

```ts
'use server';

import { randomBytes } from 'crypto';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { TIER_FEATURES } from '@alga-psa/types';
import { createTenantKnex } from '@/lib/db';
import { getWebhookBaseUrl } from '@alga-psa/integrations/utils/email/webhookHelpers';
import { buildIntegrationDisconnectedPayload } from '@alga-psa/workflow-streams';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { runRmmSyncWithTransport } from '../../integrations/rmm/sync/syncOrchestration';
import {
  createLevelIoClient,
  DEFAULT_LEVELIO_BASE_URL,
  LevelIoApiClient,
  LEVELIO_API_KEY_SECRET,
  LEVELIO_WEBHOOK_SECRET_KEY,
} from '../../integrations/levelio/levelApiClient';
import {
  runLevelIoAlertsBackfill,
  runLevelIoDeviceSync,
  runLevelIoFullSync,
  runLevelIoScopeSync,
} from '../../integrations/levelio/sync/syncEngine';
import {
  levelIoTransportOverride,
  startLevelIoDeviceSyncWorkflow,
  startLevelIoSyncWorkflow,
  type LevelIoWorkflowSyncType,
} from '../../integrations/levelio/sync/transport';

const PROVIDER = 'levelio' as const;

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withAdvancedAssetsAccess<TArgs extends unknown[], TResult>(
  handler: (user: any, context: { tenant: string }, ...args: TArgs) => Promise<TResult>,
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS);
    return handler(user, context as { tenant: string }, ...args);
  });
}

async function getLevelIoIntegration(tenant: string) {
  const { knex } = await createTenantKnex();
  const integration = await knex('rmm_integrations')
    .where({ tenant, provider: PROVIDER })
    .first([
      'integration_id',
      'is_active',
      'connected_at',
      'last_sync_at',
      'last_full_sync_at',
      'sync_status',
      'sync_error',
    ]);
  return { knex, integration };
}

async function upsertLevelIoIntegrationRow(args: {
  tenant: string;
  isActive?: boolean;
  connectedAt?: Date | null;
  syncStatus?: 'pending' | 'syncing' | 'completed' | 'error';
  syncError?: string | null;
}) {
  const { knex } = await createTenantKnex();
  const settings = { provider_settings: { levelio: {} } };

  const response = await knex('rmm_integrations')
    .insert({
      tenant: args.tenant,
      provider: PROVIDER,
      instance_url: DEFAULT_LEVELIO_BASE_URL,
      is_active: args.isActive ?? false,
      connected_at: args.connectedAt ?? null,
      sync_status: args.syncStatus ?? 'pending',
      sync_error: args.syncError ?? null,
      settings,
      updated_at: knex.fn.now(),
    })
    .onConflict(['tenant', 'provider'])
    .merge({
      instance_url: DEFAULT_LEVELIO_BASE_URL,
      is_active: typeof args.isActive === 'boolean' ? args.isActive : knex.raw('rmm_integrations.is_active'),
      connected_at: args.connectedAt ?? knex.raw('rmm_integrations.connected_at'),
      sync_status: args.syncStatus ?? knex.raw('rmm_integrations.sync_status'),
      sync_error: args.syncError ?? null,
      updated_at: knex.fn.now(),
    })
    .returning(['integration_id', 'is_active', 'instance_url', 'connected_at', 'sync_status', 'sync_error']);

  return Array.isArray(response) ? response[0] : response;
}

async function runLevelIoSyncOperation(args: {
  tenant: string;
  operation: 'scope_sync' | 'full_sync' | 'alerts_backfill';
  syncType: LevelIoWorkflowSyncType;
}) {
  const { knex, integration } = await getLevelIoIntegration(args.tenant);
  if (!integration?.integration_id) {
    throw new Error('Level integration is not configured.');
  }

  const engineByType = {
    organizations: runLevelIoScopeSync,
    full: runLevelIoFullSync,
    alerts: runLevelIoAlertsBackfill,
  } as const;

  return runRmmSyncWithTransport({
    context: {
      provider: PROVIDER,
      operation: args.operation,
      input: { tenant: args.tenant },
    },
    transportOverride: levelIoTransportOverride(),
    directExecutor: async () => {
      const client = await createLevelIoClient(args.tenant);
      return engineByType[args.syncType](
        { tenant: args.tenant, integrationId: integration.integration_id },
        { knex, client }
      );
    },
    temporalExecutor: async () =>
      startLevelIoSyncWorkflow({
        tenantId: args.tenant,
        integrationId: integration.integration_id,
        syncType: args.syncType,
      }),
  });
}

export const getLevelIoSettings = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { integration } = await getLevelIoIntegration(tenant);
    const secretProvider = await getSecretProviderInstance();
    const apiKey = await secretProvider.getTenantSecret(tenant, LEVELIO_API_KEY_SECRET);

    return {
      success: true,
      config: {
        integrationId: integration?.integration_id || null,
        isActive: Boolean(integration?.is_active),
        connectedAt: integration?.connected_at || null,
        lastSyncAt: integration?.last_sync_at || null,
        lastFullSyncAt: integration?.last_full_sync_at || null,
        syncStatus: integration?.sync_status || 'pending',
        syncError: integration?.sync_error || null,
      },
      credentials: {
        hasApiKey: Boolean(apiKey),
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const saveLevelIoConfiguration = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: { apiKey?: string }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    const candidateKey =
      input.apiKey?.trim() || (await secretProvider.getTenantSecret(tenant, LEVELIO_API_KEY_SECRET)) || '';
    if (!candidateKey) {
      return { success: false, error: 'A Level API key is required.' };
    }

    // Validate the key against the live API before persisting anything.
    const client = new LevelIoApiClient({
      apiKey: candidateKey,
      baseUrl: process.env.LEVELIO_API_BASE_URL || DEFAULT_LEVELIO_BASE_URL,
    });
    await client.testConnection();

    if (input.apiKey?.trim()) {
      await secretProvider.setTenantSecret(tenant, LEVELIO_API_KEY_SECRET, input.apiKey.trim());
    }

    const existingWebhookSecret = await secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY);
    if (!existingWebhookSecret) {
      await secretProvider.setTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY, randomBytes(24).toString('hex'));
    }

    const row = await upsertLevelIoIntegrationRow({
      tenant,
      isActive: true,
      connectedAt: new Date(),
      syncError: null,
    });

    return { success: true, integrationId: row.integration_id as string };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const testLevelIoConnection = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const client = await createLevelIoClient(tenant);
    await client.testConnection();

    await upsertLevelIoIntegrationRow({
      tenant,
      isActive: true,
      connectedAt: new Date(),
      syncStatus: 'pending',
      syncError: null,
    });

    return { success: true };
  } catch (error) {
    try {
      const { knex } = await createTenantKnex();
      await knex('rmm_integrations')
        .where({ tenant, provider: PROVIDER })
        .update({
          is_active: false,
          sync_error: sanitizeError(error),
          updated_at: knex.fn.now(),
        });
    } catch {
      // Best effort.
    }

    return { success: false, error: sanitizeError(error) };
  }
});

export const disconnectLevelIoIntegration = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getLevelIoIntegration(tenant);

    const secretProvider = await getSecretProviderInstance();
    await Promise.all([
      secretProvider.deleteTenantSecret(tenant, LEVELIO_API_KEY_SECRET),
      secretProvider.deleteTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY),
    ]);

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({
        is_active: false,
        connected_at: null,
        sync_status: 'pending',
        sync_error: null,
        updated_at: knex.fn.now(),
      });

    if (integration?.integration_id) {
      const disconnectedAt = new Date().toISOString();
      try {
        await publishWorkflowEvent({
          eventType: 'INTEGRATION_DISCONNECTED',
          payload: buildIntegrationDisconnectedPayload({
            integrationId: integration.integration_id,
            provider: PROVIDER,
            connectionId: integration.integration_id,
            disconnectedAt,
            disconnectedByUserId: user.user_id,
            reason: 'user_requested',
          }),
          ctx: {
            tenantId: tenant,
            actor: { actorType: 'USER', actorUserId: user.user_id },
            occurredAt: disconnectedAt,
          },
          idempotencyKey: `integration_disconnected:${tenant}:${integration.integration_id}:${disconnectedAt}`,
        });
      } catch {
        // Best-effort event.
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const syncLevelIoOrganizations = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    return await runLevelIoSyncOperation({ tenant, operation: 'scope_sync', syncType: 'organizations' });
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const triggerLevelIoFullSync = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    return await runLevelIoSyncOperation({ tenant, operation: 'full_sync', syncType: 'full' });
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const backfillLevelIoAlerts = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    return await runLevelIoSyncOperation({ tenant, operation: 'alerts_backfill', syncType: 'alerts' });
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const syncLevelIoSingleDevice = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  deviceId: string
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getLevelIoIntegration(tenant);
    if (!integration?.integration_id) {
      return { success: false, error: 'Level integration is not configured.' };
    }

    const outcome = await runRmmSyncWithTransport({
      context: { provider: PROVIDER, operation: 'device_sync', input: { tenant, deviceId } },
      transportOverride: levelIoTransportOverride(),
      directExecutor: async () => {
        const client = await createLevelIoClient(tenant);
        return runLevelIoDeviceSync(
          { tenant, integrationId: integration.integration_id, deviceId },
          { knex, client }
        );
      },
      temporalExecutor: async () =>
        (await startLevelIoDeviceSyncWorkflow({
          tenantId: tenant,
          integrationId: integration.integration_id,
          deviceId,
          waitForResult: true,
        }))!,
    });

    return { success: true, outcome };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const listLevelIoOrganizationMappings = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getLevelIoIntegration(tenant);
    if (!integration?.integration_id) {
      return { success: true, mappings: [], clients: [] };
    }

    const rows = await knex('rmm_organization_mappings as rom')
      .leftJoin('clients as c', function joinClient() {
        this.on('rom.tenant', '=', 'c.tenant').andOn('rom.client_id', '=', 'c.client_id');
      })
      .where({
        'rom.tenant': tenant,
        'rom.integration_id': integration.integration_id,
      })
      .select([
        'rom.mapping_id',
        'rom.external_organization_id',
        'rom.external_organization_name',
        'rom.client_id',
        'rom.auto_sync_assets',
        'rom.auto_create_tickets',
        'rom.metadata',
        'rom.last_synced_at',
        'c.client_name as client_name',
      ])
      .orderBy('rom.external_organization_name', 'asc');

    const clients = await knex('clients')
      .where({ tenant })
      .select(['client_id', 'client_name'])
      .orderBy('client_name', 'asc');

    return { success: true, mappings: rows, clients };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const updateLevelIoOrganizationMapping = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: {
    mappingId: string;
    clientId?: string | null;
    autoSyncAssets?: boolean;
    autoCreateTickets?: boolean;
  }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const patch: Record<string, unknown> = {
      updated_at: knex.fn.now(),
    };
    if (typeof input.clientId !== 'undefined') patch.client_id = input.clientId || null;
    if (typeof input.autoSyncAssets !== 'undefined') patch.auto_sync_assets = input.autoSyncAssets;
    if (typeof input.autoCreateTickets !== 'undefined') patch.auto_create_tickets = input.autoCreateTickets;

    await knex('rmm_organization_mappings')
      .where({ tenant, mapping_id: input.mappingId })
      .update(patch);

    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const getLevelIoWebhookInfo = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    let secret = await secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY);
    if (!secret) {
      secret = randomBytes(24).toString('hex');
      await secretProvider.setTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY, secret);
    }

    const baseUrl = getWebhookBaseUrl().replace(/\/$/, '');
    const payloadTemplate = JSON.stringify(
      {
        event: 'alert.triggered',
        alert_id: '{{alert_id}}',
        device_id: '{{device_id}}',
        hostname: '{{hostname}}',
        name: '{{alert_name}}',
        severity: '{{severity}}',
        description: '{{description}}',
      },
      null,
      2
    );

    return {
      success: true,
      webhook: {
        url: `${baseUrl}/api/webhooks/levelio?tenant=${encodeURIComponent(tenant)}`,
        headerName: 'X-Alga-Webhook-Secret',
        secret,
        payloadTemplate,
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const getLevelIoConnectionSummary = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getLevelIoIntegration(tenant);
    if (!integration?.integration_id) {
      return { success: true, summary: { mappedGroups: 0, devices: 0, activeAlerts: 0 } };
    }

    const [mappedGroups, devices, activeAlerts] = await Promise.all([
      knex('rmm_organization_mappings')
        .where({ tenant, integration_id: integration.integration_id })
        .whereNotNull('client_id')
        .count<{ count: string }[]>('mapping_id as count'),
      knex('assets').where({ tenant, rmm_provider: PROVIDER }).count<{ count: string }[]>('asset_id as count'),
      knex('rmm_alerts')
        .where({ tenant, integration_id: integration.integration_id, status: 'active' })
        .count<{ count: string }[]>('alert_id as count'),
    ]);

    return {
      success: true,
      summary: {
        mappedGroups: Number(mappedGroups[0]?.count ?? 0),
        devices: Number(devices[0]?.count ?? 0),
        activeAlerts: Number(activeAlerts[0]?.count ?? 0),
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});
```

- [ ] **Step 2: Verify the existing test suites still pass and nothing new breaks**

Run: `cd ee/server && npx vitest run src/__tests__/unit/integrations/`
Expected: PASS (all Level.io tests from Tasks 2–5 plus pre-existing tanium/rmm tests)

- [ ] **Step 3: Commit**

```bash
git add ee/server/src/lib/actions/integrations/levelIoActions.ts
git commit -m "feat(levelio): add server actions with transport-routed sync operations"
```

---

### Task 8: Inbound webhook routes

**Files:**
- Create: `ee/server/src/app/api/webhooks/levelio/route.ts` (real EE implementation)
- Create: `packages/ee/src/app/api/webhooks/levelio/route.ts` (CE stub)
- Create: `server/src/app/api/webhooks/levelio/route.ts` (re-export shim)

- [ ] **Step 1: Create the EE webhook route**

Create `ee/server/src/app/api/webhooks/levelio/route.ts`:

```ts
/**
 * Level.io Webhook Endpoint (alert automations)
 *
 * Level's API cannot register webhooks; users configure an HTTP POST action in
 * a Level automation pointing at this endpoint.
 * Auth: shared-secret header `X-Alga-Webhook-Secret` + tenant query param.
 */

import { NextResponse } from 'next/server';
import { createTenantKnex } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import {
  createLevelIoClient,
  LEVELIO_WEBHOOK_SECRET_KEY,
} from '../../../../lib/integrations/levelio/levelApiClient';
import { mapLevelIoSeverity } from '../../../../lib/integrations/levelio/mappers/deviceMapper';
import { runLevelIoDeviceSync } from '../../../../lib/integrations/levelio/sync/syncEngine';
import {
  levelIoTransportOverride,
  startLevelIoDeviceSyncWorkflow,
} from '../../../../lib/integrations/levelio/sync/transport';

export const runtime = 'nodejs';

const PROVIDER = 'levelio';
const HEADER_NAME = 'x-alga-webhook-secret';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenant = url.searchParams.get('tenant') || '';
    if (!tenant) {
      return NextResponse.json({ error: 'Missing tenant' }, { status: 400 });
    }

    const providedSecret = req.headers.get(HEADER_NAME) || req.headers.get('X-Alga-Webhook-Secret') || '';
    if (!providedSecret) {
      return NextResponse.json({ error: 'Unauthorized: missing webhook secret' }, { status: 401 });
    }

    const secretProvider = await getSecretProviderInstance();
    const expectedSecret = await secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY);
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized: invalid webhook secret' }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as any;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const deviceId = String(body.device_id || '').trim();
    if (!deviceId) {
      return NextResponse.json({ error: 'device_id is required' }, { status: 400 });
    }

    const event = String(body.event || 'alert.triggered').toLowerCase();
    const status = event.includes('resolve') ? 'resolved' : 'active';
    const externalAlertId = body.alert_id
      ? String(body.alert_id)
      : `${deviceId}:${event}:${new Date().toISOString()}`;

    const severity = mapLevelIoSeverity(body.severity);
    const name = body.name ? String(body.name) : 'Level alert';
    const description = body.description ? String(body.description) : null;
    const message = description ? `${name}: ${description}` : name;

    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id']);

    if (!integration?.integration_id) {
      // Accept webhook calls even if not fully configured; return 200 to avoid retries.
      return NextResponse.json({ ok: true, recorded: false, reason: 'integration_not_configured' }, { status: 200 });
    }

    // Associate to asset when possible via external entity mapping.
    let assetId: string | undefined;
    const mapping = await knex('tenant_external_entity_mappings')
      .where({
        tenant,
        integration_type: PROVIDER,
        alga_entity_type: 'asset',
        external_entity_id: deviceId,
      })
      .first(['alga_entity_id']);
    assetId = mapping?.alga_entity_id;

    // Best-effort observability event.
    try {
      await publishEvent({
        eventType: 'RMM_WEBHOOK_RECEIVED',
        payload: {
          tenantId: tenant,
          occurredAt: new Date().toISOString(),
          integrationId: integration.integration_id,
          provider: PROVIDER,
          webhookEventType: event,
          externalDeviceId: deviceId,
          assetId: assetId,
          rawPayload: body,
        },
      } as any);
    } catch {
      // ignore
    }

    const existing = await knex('rmm_alerts')
      .where({
        tenant,
        integration_id: integration.integration_id,
        external_alert_id: externalAlertId,
      })
      .first(['alert_id']);

    const baseRow = {
      tenant,
      integration_id: integration.integration_id,
      external_alert_id: externalAlertId,
      external_device_id: deviceId,
      asset_id: assetId || null,
      severity,
      priority: null,
      source_type: 'levelio_webhook',
      status,
      message,
      device_name: body.hostname ? String(body.hostname) : null,
      metadata: body,
      triggered_at: body.alert_time ? String(body.alert_time) : new Date().toISOString(),
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      updated_at: knex.fn.now(),
    };

    if (existing?.alert_id) {
      await knex('rmm_alerts')
        .where({ tenant, alert_id: existing.alert_id })
        .update(baseRow);
    } else {
      await knex('rmm_alerts')
        .insert({ ...baseRow, created_at: knex.fn.now() });
    }

    // Best-effort: refresh the affected device without blocking the response.
    try {
      if (levelIoTransportOverride() === 'temporal') {
        await startLevelIoDeviceSyncWorkflow({
          tenantId: tenant,
          integrationId: integration.integration_id,
          deviceId,
          waitForResult: false,
        });
      } else {
        const client = await createLevelIoClient(tenant);
        await runLevelIoDeviceSync(
          { tenant, integrationId: integration.integration_id, deviceId },
          { knex, client }
        );
      }
    } catch {
      // ignore — the alert is already recorded.
    }

    return NextResponse.json({ ok: true, recorded: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Webhook error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the CE stub**

Create `packages/ee/src/app/api/webhooks/levelio/route.ts`:

```ts
/**
 * Empty Level.io Webhook Route for Community Edition
 *
 * The Level.io integration is only available in the Enterprise Edition.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json(
    { error: 'Level.io integration is only available in the Enterprise Edition' },
    { status: 404 }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
```

- [ ] **Step 3: Create the server re-export shim**

Create `server/src/app/api/webhooks/levelio/route.ts`:

```ts
/**
 * Level.io Webhook Endpoint
 *
 * Re-exports the EE implementation (CE builds resolve @enterprise to the stub).
 */

export const runtime = 'nodejs';

export { POST, OPTIONS } from '@enterprise/app/api/webhooks/levelio/route';
```

- [ ] **Step 4: Commit**

```bash
git add ee/server/src/app/api/webhooks/levelio/route.ts packages/ee/src/app/api/webhooks/levelio/route.ts server/src/app/api/webhooks/levelio/route.ts
git commit -m "feat(levelio): add inbound alert webhook route with fire-and-forget device refresh"
```

---

### Task 9: Settings UI component

**Files:**
- Create: `ee/server/src/components/settings/integrations/LevelIoIntegrationSettings.tsx`
- Create: `packages/ee/src/components/settings/integrations/LevelIoIntegrationSettings.tsx` (CE stub)

The component uses `t(key, { defaultValue })` everywhere so English works without locale-file edits (translations can be added to `server/public/locales/*/msp/integrations.json` later).

- [ ] **Step 1: Create the EE component**

Create `ee/server/src/components/settings/integrations/LevelIoIntegrationSettings.tsx`:

```tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  backfillLevelIoAlerts,
  disconnectLevelIoIntegration,
  getLevelIoConnectionSummary,
  getLevelIoSettings,
  getLevelIoWebhookInfo,
  listLevelIoOrganizationMappings,
  saveLevelIoConfiguration,
  syncLevelIoOrganizations,
  testLevelIoConnection,
  triggerLevelIoFullSync,
  updateLevelIoOrganizationMapping,
} from '../../../lib/actions/integrations/levelIoActions';

type MappingRow = {
  mapping_id: string;
  external_organization_id: string;
  external_organization_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  auto_sync_assets: boolean;
  metadata?: { path?: string } | null;
};

type ClientRow = {
  client_id: string;
  client_name: string;
};

type WebhookInfo = {
  url: string;
  headerName: string;
  secret: string;
  payloadTemplate: string;
};

export default function LevelIoIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  const [isActive, setIsActive] = useState(false);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('pending');
  const [syncError, setSyncError] = useState<string | null>(null);

  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [summary, setSummary] = useState<{ mappedGroups: number; devices: number; activeAlerts: number } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isSaving, startSaving] = useTransition();
  const [isTesting, startTesting] = useTransition();
  const [isDisconnecting, startDisconnecting] = useTransition();
  const [isGroupSyncing, startGroupSyncing] = useTransition();
  const [isDeviceSyncing, startDeviceSyncing] = useTransition();
  const [isAlertSyncing, startAlertSyncing] = useTransition();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [settingsResult, mappingResult, webhookResult, summaryResult] = await Promise.all([
        getLevelIoSettings(),
        listLevelIoOrganizationMappings(),
        getLevelIoWebhookInfo(),
        getLevelIoConnectionSummary(),
      ]);

      if (!settingsResult.success) {
        setError(settingsResult.error || t('integrations.rmm.levelio.errors.loadSettings', { defaultValue: 'Failed to load Level settings' }));
      } else {
        const config = settingsResult.config;
        setIsActive(Boolean(config?.isActive));
        setConnectedAt(config?.connectedAt || null);
        setSyncStatus(config?.syncStatus || 'pending');
        setSyncError(config?.syncError || null);
        setHasApiKey(Boolean(settingsResult.credentials?.hasApiKey));
      }

      if (mappingResult.success) {
        setMappings((mappingResult.mappings || []) as MappingRow[]);
        setClients((mappingResult.clients || []) as ClientRow[]);
      }
      if (webhookResult.success && webhookResult.webhook) {
        setWebhook(webhookResult.webhook as WebhookInfo);
      }
      if (summaryResult.success && summaryResult.summary) {
        setSummary(summaryResult.summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('integrations.rmm.levelio.errors.loadState', { defaultValue: 'Failed to load Level integration state' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const statusBadge = useMemo(() => {
    if (isActive) return <Badge variant="default">{t('integrations.rmm.levelio.status.connected', { defaultValue: 'Connected' })}</Badge>;
    return <Badge variant="outline">{t('integrations.rmm.levelio.status.disconnected', { defaultValue: 'Not connected' })}</Badge>;
  }, [isActive, t]);

  const handleSave = () => {
    startSaving(async () => {
      setError(null);
      setSuccess(null);
      const result = await saveLevelIoConfiguration({ apiKey: apiKey.trim() || undefined });
      if (result.success) {
        setApiKey('');
        setSuccess(t('integrations.rmm.levelio.success.configurationSaved', { defaultValue: 'Level configuration saved' }));
        await refresh();
      } else {
        setError(result.error || t('integrations.rmm.levelio.errors.saveConfiguration', { defaultValue: 'Failed to save Level configuration' }));
      }
    });
  };

  const handleTest = () => {
    startTesting(async () => {
      setError(null);
      setSuccess(null);
      const result = await testLevelIoConnection();
      if (result.success) {
        setSuccess(t('integrations.rmm.levelio.success.connectionTestSucceeded', { defaultValue: 'Connection to Level succeeded' }));
      } else {
        setError(result.error || t('integrations.rmm.levelio.errors.testConnectionFailed', { defaultValue: 'Connection test failed' }));
      }
      await refresh();
    });
  };

  const handleDisconnect = () => {
    startDisconnecting(async () => {
      setError(null);
      setSuccess(null);
      const result = await disconnectLevelIoIntegration();
      if (result.success) {
        setSuccess(t('integrations.rmm.levelio.success.disconnected', { defaultValue: 'Level integration disconnected' }));
      } else {
        setError(result.error || t('integrations.rmm.levelio.errors.disconnectFailed', { defaultValue: 'Failed to disconnect Level integration' }));
      }
      await refresh();
    });
  };

  const handleGroupSync = () => {
    startGroupSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await syncLevelIoOrganizations();
      if (result.success && 'items_processed' in result) {
        setSuccess(
          t('integrations.rmm.levelio.success.groupSyncCompleted', {
            defaultValue: 'Group discovery completed: {{processed}} processed, {{created}} created, {{updated}} updated',
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          })
        );
      } else {
        setError((result as any).error || t('integrations.rmm.levelio.errors.groupSyncFailed', { defaultValue: 'Group discovery failed' }));
      }
      await refresh();
    });
  };

  const handleDeviceSync = () => {
    startDeviceSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await triggerLevelIoFullSync();
      if (result.success && 'items_processed' in result) {
        setSuccess(
          t('integrations.rmm.levelio.success.deviceSyncCompleted', {
            defaultValue: 'Device sync completed: {{processed}} processed, {{created}} created, {{updated}} updated',
            processed: result.items_processed,
            created: result.items_created,
            updated: result.items_updated,
          })
        );
      } else {
        setError((result as any).error || t('integrations.rmm.levelio.errors.deviceSyncFailed', { defaultValue: 'Device sync failed' }));
      }
      await refresh();
    });
  };

  const handleAlertBackfill = () => {
    startAlertSyncing(async () => {
      setError(null);
      setSuccess(null);
      const result = await backfillLevelIoAlerts();
      if (result.success && 'items_processed' in result) {
        setSuccess(
          t('integrations.rmm.levelio.success.alertBackfillCompleted', {
            defaultValue: 'Alert backfill completed: {{processed}} alerts processed',
            processed: result.items_processed,
          })
        );
      } else {
        setError((result as any).error || t('integrations.rmm.levelio.errors.alertBackfillFailed', { defaultValue: 'Alert backfill failed' }));
      }
      await refresh();
    });
  };

  const handleMappingClientChange = (mappingId: string, clientId: string) => {
    void (async () => {
      const result = await updateLevelIoOrganizationMapping({
        mappingId,
        clientId: clientId || null,
      });
      if (!result.success) {
        setError(result.error || t('integrations.rmm.levelio.errors.updateMappingFailed', { defaultValue: 'Failed to update mapping' }));
        return;
      }
      await refresh();
    })();
  };

  return (
    <div className="space-y-6" id="levelio-integration-settings">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.rmm.levelio.connection.title', { defaultValue: 'Level Connection' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.levelio.connection.description', {
              defaultValue: 'Connect to Level (level.io) with an API key. Keys are created in Level under Settings > API.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t('integrations.rmm.levelio.status.label', { defaultValue: 'Status: ' })}{statusBadge}
            </div>
            <div className="text-sm text-muted-foreground">
              {syncError
                ? t('integrations.rmm.levelio.connection.syncLabelWithError', { defaultValue: 'Sync: {{status}} ({{error}})', status: syncStatus, error: syncError })
                : t('integrations.rmm.levelio.connection.syncLabel', { defaultValue: 'Sync: {{status}}', status: syncStatus })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('integrations.rmm.levelio.fields.apiKey', {
                defaultValue: 'API key ({{state}})',
                state: hasApiKey
                  ? t('integrations.rmm.levelio.fields.apiKeyStateSaved', { defaultValue: 'saved' })
                  : t('integrations.rmm.levelio.fields.apiKeyStateRequired', { defaultValue: 'required' }),
              })}
            </label>
            <Input
              id="levelio-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey
                ? t('integrations.rmm.levelio.fields.apiKeyPlaceholderExisting', { defaultValue: 'Enter a new key to replace the saved one' })
                : t('integrations.rmm.levelio.fields.apiKeyPlaceholderNew', { defaultValue: 'Paste your Level API key' })}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button id="levelio-save-config" onClick={handleSave} disabled={isSaving || isLoading}>
              {t('integrations.rmm.levelio.actions.saveConfiguration', { defaultValue: 'Save Configuration' })}
            </Button>
            <Button id="levelio-test-connection" variant="outline" onClick={handleTest} disabled={isTesting || isLoading}>
              {t('integrations.rmm.levelio.actions.testConnection', { defaultValue: 'Test Connection' })}
            </Button>
            <Button id="levelio-disconnect" variant="outline" onClick={handleDisconnect} disabled={isDisconnecting || isLoading}>
              {t('integrations.rmm.levelio.actions.disconnect', { defaultValue: 'Disconnect' })}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {t('integrations.rmm.levelio.connection.connectedAt', {
              defaultValue: 'Connected: {{time}}',
              time: connectedAt ? new Date(connectedAt).toLocaleString() : t('integrations.rmm.levelio.connection.never', { defaultValue: 'never' }),
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.rmm.levelio.sync.title', { defaultValue: 'Sync & Group Mappings' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.levelio.sync.description', {
              defaultValue: 'Discover Level groups, map them to clients, and sync devices. Devices in unmapped groups are skipped; subgroups inherit the nearest mapped ancestor.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button id="levelio-sync-groups" onClick={handleGroupSync} disabled={isGroupSyncing || isLoading}>
              {t('integrations.rmm.levelio.actions.discoverGroups', { defaultValue: 'Discover Groups' })}
            </Button>
            <Button id="levelio-sync-devices" onClick={handleDeviceSync} disabled={isDeviceSyncing || isLoading}>
              {t('integrations.rmm.levelio.actions.runDeviceSync', { defaultValue: 'Run Device Sync' })}
            </Button>
            <Button id="levelio-backfill-alerts" variant="outline" onClick={handleAlertBackfill} disabled={isAlertSyncing || isLoading}>
              {t('integrations.rmm.levelio.actions.backfillAlerts', { defaultValue: 'Backfill Alerts' })}
            </Button>
          </div>

          {summary ? (
            <div className="text-xs text-muted-foreground">
              {t('integrations.rmm.levelio.sync.summary', {
                defaultValue: '{{mappedGroups}} mapped groups · {{devices}} devices · {{activeAlerts}} active alerts',
                mappedGroups: summary.mappedGroups,
                devices: summary.devices,
                activeAlerts: summary.activeAlerts,
              })}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.levelio.mappings.group', { defaultValue: 'Level Group' })}</th>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.levelio.mappings.mappedClient', { defaultValue: 'Mapped Client' })}</th>
                  <th className="px-3 py-2 text-left">{t('integrations.rmm.levelio.mappings.autoSync', { defaultValue: 'Auto Sync' })}</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.mapping_id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {mapping.metadata?.path || mapping.external_organization_name || mapping.external_organization_id}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('integrations.rmm.levelio.mappings.groupIdLabel', { defaultValue: 'ID: {{id}}', id: mapping.external_organization_id })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="h-9 w-full rounded-md border px-2"
                        value={mapping.client_id || ''}
                        onChange={(e) => handleMappingClientChange(mapping.mapping_id, e.target.value)}
                      >
                        <option value="">{t('integrations.rmm.levelio.mappings.unmapped', { defaultValue: 'Not mapped' })}</option>
                        {clients.map((client) => (
                          <option key={client.client_id} value={client.client_id}>
                            {client.client_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {mapping.auto_sync_assets
                        ? <Badge variant="default">{t('integrations.rmm.levelio.mappings.autoSyncEnabled', { defaultValue: 'Enabled' })}</Badge>
                        : <Badge variant="outline">{t('integrations.rmm.levelio.mappings.autoSyncDisabled', { defaultValue: 'Disabled' })}</Badge>}
                    </td>
                  </tr>
                ))}
                {!mappings.length ? (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                      {isLoading
                        ? t('integrations.rmm.levelio.mappings.loading', { defaultValue: 'Loading…' })
                        : t('integrations.rmm.levelio.mappings.noGroups', { defaultValue: 'No groups discovered yet. Run Discover Groups first.' })}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.rmm.levelio.webhook.title', { defaultValue: 'Alert Webhook' })}</CardTitle>
          <CardDescription>
            {t('integrations.rmm.levelio.webhook.description', {
              defaultValue: 'Level cannot register webhooks via its API. In Level, create an automation with an HTTP POST action using the URL, header, and payload below to push alerts into Alga in real time.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {webhook ? (
            <>
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.levelio.webhook.url', { defaultValue: 'Webhook URL' })}</div>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{webhook.url}</code>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {t('integrations.rmm.levelio.webhook.header', { defaultValue: 'Header: {{name}}', name: webhook.headerName })}
                </div>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{webhook.secret}</code>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">{t('integrations.rmm.levelio.webhook.payload', { defaultValue: 'Payload template' })}</div>
                <pre className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">{webhook.payloadTemplate}</pre>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('integrations.rmm.levelio.webhook.loading', { defaultValue: 'Webhook details load after the integration is configured.' })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create the CE stub component**

Create `packages/ee/src/components/settings/integrations/LevelIoIntegrationSettings.tsx`:

```tsx
'use client';

import React from 'react';

const LevelIoIntegrationSettings: React.FC = () => {
  return (
    <div className="py-8 text-center text-muted-foreground">
      <p className="text-lg font-medium">Enterprise Feature</p>
      <p className="mt-2 text-sm">
        Level.io RMM integration is available in the Enterprise edition of Alga PSA.
      </p>
    </div>
  );
};

export default LevelIoIntegrationSettings;
```

- [ ] **Step 3: Commit**

```bash
git add ee/server/src/components/settings/integrations/LevelIoIntegrationSettings.tsx packages/ee/src/components/settings/integrations/LevelIoIntegrationSettings.tsx
git commit -m "feat(levelio): add Level integration settings UI"
```

---

### Task 10: Provider registry entry and settings page wiring

**Files:**
- Modify: `packages/integrations/src/lib/rmm/providerRegistry.ts`
- Modify: `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`
- Test: `packages/integrations/src/lib/rmm/providerRegistry.test.ts`

- [ ] **Step 1: Write the failing registry test**

Append inside the existing `describe('RMM provider registry', ...)` block in `packages/integrations/src/lib/rmm/providerRegistry.test.ts`:

```ts
  it('exposes Level metadata gated by enterprise and feature flag', () => {
    const levelio = getRmmProviderMetadata('levelio');
    expect(levelio).toBeDefined();
    expect(levelio?.title).toBe('Level');
    expect(levelio?.requiresEnterprise).toBe(true);
    expect(levelio?.featureFlagKey).toBe('levelio-rmm-integration');
    expect(levelio?.capabilities).toEqual({
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: false,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/integrations && npx vitest run src/lib/rmm/providerRegistry.test.ts`
Expected: FAIL — `'levelio'` not assignable / metadata undefined

- [ ] **Step 3: Add the registry entry**

In `packages/integrations/src/lib/rmm/providerRegistry.ts`:

Change the icon union (line 25):

```ts
  icon: 'tacticalrmm' | 'ninjaone' | 'tanium' | 'levelio';
```

Change the featureFlagKey union (line 30):

```ts
  featureFlagKey?: 'tactical-rmm-integration' | 'tanium-rmm-integration' | 'levelio-rmm-integration';
```

Change the availability context (line 35):

```ts
  enabledFeatureFlags: Partial<Record<'tactical-rmm-integration' | 'tanium-rmm-integration' | 'levelio-rmm-integration', boolean>>;
```

Append a new entry to `RMM_PROVIDER_REGISTRY` after the Tanium entry:

```ts
  {
    id: 'levelio',
    title: 'Level',
    description: 'Sync devices and groups from Level (level.io) with alert ingestion via automation webhooks (Enterprise).',
    icon: 'levelio',
    badge: { label: 'Enterprise', variant: 'secondary' },
    highlights: [
      { label: 'Sync', value: 'Devices' },
      { label: 'Realtime', value: 'Alerts' }
    ],
    capabilities: {
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: false
    },
    requiresEnterprise: true,
    featureFlagKey: 'levelio-rmm-integration'
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/integrations && npx vitest run src/lib/rmm/providerRegistry.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire into RmmIntegrationsSetup**

In `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`:

Add a loading component after `TaniumLoading`:

```tsx
function LevelIoLoading() {
  const { t } = useTranslation('msp/integrations');
  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex flex-col items-center justify-center gap-2">
          <Spinner size="md" />
          <span className="text-sm text-muted-foreground">{t('integrations.rmm.levelio.loading', { defaultValue: 'Loading Level integration settings...' })}</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

Add a dynamic import after the `TaniumIntegrationSettings` dynamic import:

```tsx
const LevelIoIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/LevelIoIntegrationSettings'),
  {
    loading: () => <LevelIoLoading />,
    ssr: false
  }
);
```

Add to `providerSettingsComponents`:

```tsx
const providerSettingsComponents: Partial<Record<RmmProvider, React.ComponentType>> = {
  tacticalrmm: TacticalRmmIntegrationSettings,
  ninjaone: NinjaOneIntegrationSettings,
  tanium: TaniumIntegrationSettings,
  levelio: LevelIoIntegrationSettings
};
```

Add a banner icon case in `IntegrationBanner` before `default`:

```tsx
      case 'levelio':
        return <BannerIcon className="bg-blue-600 text-xl font-bold text-white">L</BannerIcon>;
```

In the `RmmIntegrationsSetup` function body, add the feature flag after `taniumFlag`:

```tsx
  const levelIoFlag = useFeatureFlag('levelio-rmm-integration', { defaultValue: false });
```

and after `isTaniumEnabled`:

```tsx
  const isLevelIoEnabled = !!levelIoFlag?.enabled;
```

Update the `enabledFeatureFlags` object inside `useMemo`:

```tsx
        enabledFeatureFlags: {
          'tactical-rmm-integration': isTacticalEnabled,
          'tanium-rmm-integration': isTaniumEnabled,
          'levelio-rmm-integration': isLevelIoEnabled
        }
```

and the `useMemo` dependency array:

```tsx
    [isEEAvailable, isTacticalEnabled, isTaniumEnabled, isLevelIoEnabled]
```

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/lib/rmm/providerRegistry.ts packages/integrations/src/lib/rmm/providerRegistry.test.ts packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx
git commit -m "feat(levelio): register Level provider in registry and settings page"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run every test suite touched by this plan**

```bash
cd packages/types && npx vitest run src/interfaces/rmmProvider.typecheck.test.ts
cd ../integrations && npx vitest run src/lib/rmm/providerRegistry.test.ts
cd ../../ee/server && npx vitest run src/__tests__/unit/integrations/
```

Expected: all PASS (Level.io client/mapper/engine/transport tests, registry tests, and pre-existing tanium/rmm tests).

- [ ] **Step 2: Typecheck the touched packages**

```bash
cd ee/temporal-workflows && npx tsc --noEmit
cd ../server && npx tsc --noEmit
```

Expected: no NEW errors referencing `levelio` files (compare against the pre-change baseline if these packages have pre-existing errors).

- [ ] **Step 3: Manual smoke checklist (requires a Level API key, dev DB, and Temporal — or set `LEVELIO_SYNC_TRANSPORT=direct` to skip Temporal)**

1. Start the EE dev server; enable the `levelio-rmm-integration` feature flag for the tenant.
2. Settings → Integrations → RMM: the Level card appears with the Enterprise badge.
3. Save a valid API key → status becomes Connected; an invalid key is rejected with the API-key hint.
4. Discover Groups → mapping table shows hierarchy paths; map a top-level group to a client.
5. Run Device Sync → assets appear under that client with hardware detail, agent status, and `pending_os_patches`; devices in subgroups inherit the mapping; devices in unmapped trees are skipped.
6. Backfill Alerts → rows appear in `rmm_alerts` with mapped severities.
7. POST a sample payload to `/api/webhooks/levelio?tenant=...` with the `X-Alga-Webhook-Secret` header → alert recorded, device refresh fired.

- [ ] **Step 4: Final commit (plan checkboxes + any fixups)**

```bash
git add -A
git commit -m "chore(levelio): final verification fixups for Level.io integration"
```

---

## Out of scope (documented in the spec)

Alert→ticket rules, remote actions/Level automation triggering, software inventory (not in Level's API), incremental sync (no modified-since filter), resolving Level alerts from Alga (client method `resolveAlert` exists for the follow-up), custom-field sync, locale translations beyond English defaultValue strings.
