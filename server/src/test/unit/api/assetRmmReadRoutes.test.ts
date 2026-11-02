import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const tenant = 'review-summary-tenant';
  const assetId = '33333333-3333-3333-3333-333333333333';
  const user = { user_id: 'summary-user', tenant, user_type: 'internal', roles: [{ role_id: 'summary-role' }] };
  const state = {
    tenant, assetId, user,
    asset: {} as Record<string, any>,
    extension: {} as Record<string, any>,
    tickets: [] as Record<string, any>[],
    redactions: { asset: [] as string[], ticket: [] as string[] },
    deniedIds: new Set<string>(),
    assetPermission: true, assetUpdatePermission: true, rmmExecutePermission: true, ticketPermission: true, keyOnly: false,
    subjects: [] as any[], loaded: [] as string[],
    refreshProvider: vi.fn(async () => {}),
    remoteControlUrl: vi.fn(async (ref: { deviceId: string }) => `https://remote.example/${ref.deviceId}`),
  };
  const decide = async (input: any) => {
    state.subjects.push(input.subject);
    return {
      allowed: !state.deniedIds.has(input.record?.id ?? input.resource.id),
      redactedFields: state.keyOnly && input.subject.apiKeyId !== 'summary-key'
        ? [] : state.redactions[input.resource.type as 'asset' | 'ticket'] ?? [],
    };
  };
  const table = (name: string) => {
    state.loaded.push(name);
    const root = name.split(' as ')[0];
    let rows = root === 'assets' ? [state.asset]
      : root === 'asset_associations' ? state.tickets
      : root === 'workstation_assets' || root === 'server_assets' ? [state.extension] : [];
    const key = (s: string) => s.split('.').at(-1)!;
    const q: any = {
      where(arg: any, value?: any) {
        const filters = typeof arg === 'string' ? { [key(arg)]: value } : arg;
        rows = rows.filter(r => Object.entries(filters).every(([k,v]) => r[key(k)] === v));
        return q;
      },
      whereIn(column: string, values: unknown[]) { rows = rows.filter(r => values.includes(r[key(column)])); return q; },
      select() { return q; },
      first() { return Promise.resolve(rows[0] ? { ...rows[0] } : undefined); },
      count() { return { first: async () => ({ count: String(rows.length) }) }; },
      then(resolve: any, reject: any) { return Promise.resolve(rows.map(r => ({...r}))).then(resolve, reject); },
      catch(reject: any) { return Promise.resolve(rows.map(r => ({...r}))).catch(reject); },
    };
    for (const method of ['join', 'leftJoin', 'orderBy']) q[method] = () => q;
    return q;
  };
  const knex: any = (name: string) => table(name);
  knex.raw = (sql: string) => ({ __raw: sql });
  knex.transaction = async (fn: any) => fn(knex);
  return { state, decide, table, knex };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.state.user, { tenant: h.state.tenant }, ...args),
  hasPermission: vi.fn(async (_user: any, resource: string, action: string) => resource === 'ticket'
    ? h.state.ticketPermission : resource === 'rmm' && action === 'execute_command'
      ? h.state.rmmExecutePermission : action === 'update' ? h.state.assetUpdatePermission : h.state.assetPermission),
  getCurrentUser: vi.fn(async () => h.state.user),
  runWithApiKeyUser: vi.fn(async (_user: any, fn: any) => fn()),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async (_user: any, resource: string, action: string) => resource === 'ticket'
  ? h.state.ticketPermission : resource === 'rmm' && action === 'execute_command'
    ? h.state.rmmExecutePermission : action === 'update' ? h.state.assetUpdatePermission : h.state.assetPermission) }));
vi.mock('@/lib/api/middleware/apiAuthMiddleware', () => ({
  authenticateApiKeyRequest: vi.fn(async (request: any) => {
    request.context = { tenant: h.state.tenant, user: h.state.user, userId: h.state.user.user_id, apiKeyId: 'summary-key' };
    return request;
  }),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => h.knex) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex, tenant: h.state.tenant })),
  withTransaction: vi.fn(async (_knex: any, fn: any) => fn(h.knex)),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (name: string) => h.table(name).where({ tenant }),
    tenantJoin: (q: any) => q,
  }),
}));
vi.mock('@/lib/api/services/AssetService', () => ({
  AssetService: class {
    async getAuthorizationRecord(id: string) {
      return h.state.asset.asset_id === id ? { id, clientId: h.state.asset.client_id } : null;
    }
  },
}));
vi.mock('server/src/lib/authorization/kernel', () => ({ getAuthorizationKernel: vi.fn(async () => ({ authorizeResource: h.decide })) }));
vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {}, BundleAuthorizationKernelProvider: class {}, RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: h.decide }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(), publishNonCatalogWorkflowEvent: vi.fn() }));

import { GET } from '../../../app/api/v1/assets/[id]/summary/route';

const read = async (key = false) => GET(new Request(`http://localhost/api/v1/assets/${h.state.assetId}/summary`, {
  headers: key ? { 'x-api-key': 'summary-secret' } : {},
}), { params: Promise.resolve({ id: h.state.assetId }) });

beforeEach(() => {
  h.state.asset = {
    tenant: h.state.tenant, asset_id: h.state.assetId, client_id: 'summary-client', asset_type: 'workstation',
    agent_status: 'offline', last_seen_at: '2020-01-01T12:00:00Z', warranty_end_date: '2099-01-15',
  };
  h.state.extension = {
    tenant: h.state.tenant, asset_id: h.state.assetId, antivirus_status: 'at_risk', antivirus_product: 'Visible AV', failed_patches: 7, pending_patches: 42,
  };
  h.state.tickets = Array.from({ length: 4 }, (_, i) => ({
    tenant: h.state.tenant, asset_id: h.state.assetId, entity_type: 'ticket', entity_id: `ticket-${i}`, ticket_id: `ticket-${i}`,
    status_id: 'open-status', is_closed: false, status_is_closed: false, client_id: 'summary-client',
  }));
  h.state.redactions = { asset: [], ticket: [] };
  h.state.deniedIds = new Set();
  h.state.subjects = []; h.state.loaded = [];
  h.state.assetPermission = true; h.state.ticketPermission = true; h.state.keyOnly = false;
  h.state.assetUpdatePermission = true;
  h.state.rmmExecutePermission = true;
});


import { GET as readRmmRoute } from '../../../app/api/v1/assets/[id]/rmm/route';
const readRmm = (key = false) => readRmmRoute(new Request(`http://localhost/api/v1/assets/${h.state.assetId}/rmm`, {
  headers: key ? { 'x-api-key': 'summary-secret' } : {},
}), { params: Promise.resolve({ id: h.state.assetId }) });
beforeEach(() => {
  Object.assign(h.state.asset, { rmm_provider: 'tacticalrmm', rmm_device_id: 'device-1', last_rmm_sync_at: '2026-11-01T12:00:00Z' });
  Object.assign(h.state.extension, { current_user: 'Secret user', lan_ip: '192.168.9.9', wan_ip: '203.0.113.9', memory_usage_percent: 75, ram_gb: 32, cpu_utilization_percent: 55, disk_usage: [{ name: 'Secret volume', free_gb: 5 }] });
  h.state.refreshProvider.mockClear();
  h.state.remoteControlUrl.mockClear();
});
describe('independent RMM REST boundary review', () => {
  it('visible control uses the actual action and route', async () => {
    const response = await readRmm();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({provider:'tacticalrmm', current_user:'Secret user', lan_ip:'192.168.9.9', memory_total_gb:32});
  });
  it.each(['assets', 'assets.asset_id', 'values.asset_id'])('suppresses RMM when %s is hidden', async alias => {
    h.state.redactions.asset = [alias];
    expect((await read()).status).toBe(404);
    h.state.loaded = [];
    expect((await readRmm()).status).toBe(404);
    expect(h.state.loaded).not.toContain('workstation_assets');
  });
  it('denied asset cannot be read through RMM', async () => {
    h.state.deniedIds.add(h.state.assetId);
    expect((await read()).status).toBe(404);
    h.state.loaded = [];
    expect((await readRmm()).status).toBe(404);
    expect(h.state.loaded).not.toContain('workstation_assets');
  });
  it.each([
    ['assets.agent_status','agent_status'], ['assets.last_seen_at','last_check_in'],
    ['assets.rmm_provider','provider'], ['values.current_user','current_user'],
    ['workstation_assets.lan_ip','lan_ip'], ['workstation_assets.memory_usage_percent','memory_utilization_percent'],
    ['workstation_assets.ram_gb','memory_total_gb'], ['workstation_assets.disk_usage','storage'],
  ])('redacts source %s from response %s', async (alias, field) => {
    h.state.redactions.asset = [alias];
    const response = await readRmm();
    expect(response.status).toBe(200);
    const {data} = await response.json();
    expect(data[field] ?? null).toBeNull();
  });

  it.each([
    ['agent_status', 'agent_status'],
    ['values.last_seen_at', 'last_check_in'],
    ['assets.rmm_provider', 'provider'],
  ])('honors canonical asset alias %s for response %s', async (alias, field) => {
    h.state.redactions.asset = [alias];
    const response = await readRmm();
    expect(response.status).toBe(200);
    expect((await response.json()).data[field] ?? null).toBeNull();
  });

  it('uses server extension provenance for the renamed CPU metric', async () => {
    h.state.asset.asset_type = 'server';
    Object.assign(h.state.extension, { cpu_usage_percent: 91, cpu_utilization_percent: 64 });
    h.state.redactions.asset = ['server_assets.cpu_usage_percent'];

    const response = await readRmm();
    expect(response.status).toBe(200);
    expect((await response.json()).data.cpu_utilization_percent ?? null).toBeNull();
    expect(h.state.loaded).toContain('server_assets');
  });

  it('uses the API-key principal retained by the asset gate', async () => {
    h.state.redactions.asset = ['assets.agent_status'];
    h.state.keyOnly = true;

    const sessionResponse = await readRmm();
    expect((await sessionResponse.json()).data.agent_status).toBe('offline');
    expect(h.state.subjects.at(-1)?.apiKeyId).toBeUndefined();

    const apiKeyResponse = await readRmm(true);
    expect((await apiKeyResponse.json()).data.agent_status).toBeNull();
    expect(h.state.subjects.at(-1)?.apiKeyId).toBe('summary-key');
  });
});

vi.mock('@alga-psa/integrations/lib/rmm/assetDeviceActions', () => ({
  resolveRmmAssetDeviceActions: vi.fn(async () => ({
    refresh: h.state.refreshProvider,
    remoteControlUrl: h.state.remoteControlUrl,
  })),
}));
import { POST as refreshRmmRoute } from '../../../app/api/v1/assets/[id]/rmm/refresh/route';
const refreshRmm = (key = false) => refreshRmmRoute(new Request(`http://localhost/api/v1/assets/${h.state.assetId}/rmm/refresh`, {
  method: 'POST', headers: key ? { 'x-api-key': 'summary-secret' } : {},
}), { params: Promise.resolve({ id: h.state.assetId }) });
describe('independent refresh response boundary review', () => {
  it('visible refresh control', async () => {
    const response = await refreshRmm();
    expect(response.status).toBe(200);
    expect((await response.json()).data.lan_ip).toBe('192.168.9.9');
  });
  it.each(['assets', 'assets.asset_id'])('refresh refuses hidden resource %s', async alias => {
    h.state.redactions.asset = [alias];
    expect((await refreshRmm()).status).toBe(404);
    expect(h.state.refreshProvider).not.toHaveBeenCalled();
    expect(h.state.loaded).not.toContain('workstation_assets');
  });
  it.each([['assets.last_seen_at','last_check_in'],['workstation_assets.lan_ip','lan_ip']])('refresh does not expose %s', async (alias,field) => {
    h.state.redactions.asset = [alias];
    const response = await refreshRmm();
    expect(response.status).toBe(200);
    expect((await response.json()).data[field] ?? null).toBeNull();
  });

  it('suppresses identifier aliases before refresh provider work', async () => {
    h.state.redactions.asset = ['values.asset_id'];
    expect((await refreshRmm(true)).status).toBe(404);
    expect(h.state.refreshProvider).not.toHaveBeenCalled();
    expect(h.state.loaded).not.toContain('workstation_assets');
    expect(h.state.subjects.at(-1)?.apiKeyId).toBe('summary-key');
  });

  it('keeps refresh update authorization before provider work', async () => {
    h.state.assetUpdatePermission = false;
    expect((await refreshRmm()).status).toBe(403);
    expect(h.state.refreshProvider).not.toHaveBeenCalled();
  });

  it('denied asset cannot trigger a provider refresh', async () => {
    h.state.deniedIds.add(h.state.assetId);
    expect((await refreshRmm()).status).toBe(404);
    expect(h.state.refreshProvider).not.toHaveBeenCalled();
    expect(h.state.loaded).not.toContain('workstation_assets');
  });

  it('retains the API-key policy when projecting a visible refresh response', async () => {
    h.state.redactions.asset = ['workstation_assets.lan_ip'];
    h.state.keyOnly = true;
    const sessionResponse = await refreshRmm();
    expect((await sessionResponse.json()).data.lan_ip).toBe('192.168.9.9');
    const apiKeyResponse = await refreshRmm(true);
    expect((await apiKeyResponse.json()).data.lan_ip).toBeNull();
    expect(h.state.subjects.at(-1)?.apiKeyId).toBe('summary-key');
  });
});

import { GET as remoteControlRoute } from '../../../app/api/v1/assets/[id]/rmm/remote-control/route';

const readRemoteControl = (key = false) => remoteControlRoute(new Request(
  `http://localhost/api/v1/assets/${h.state.assetId}/rmm/remote-control`,
  { headers: key ? { 'x-api-key': 'summary-secret' } : {} },
), { params: Promise.resolve({ id: h.state.assetId }) });

describe('asset RMM remote-control REST boundary', () => {
  it('returns a visible URL through the session route and action', async () => {
    const response = await readRemoteControl();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ url: 'https://remote.example/device-1', type: 'splashtop' });
    expect(h.state.remoteControlUrl).toHaveBeenCalledOnce();
  });

  it.each(['assets', 'assets.asset_id', 'values.asset_id'])('suppresses %s before provider work', async alias => {
    h.state.redactions.asset = [alias];
    const response = await readRemoteControl();
    expect(response.status).toBe(404);
    expect(h.state.remoteControlUrl).not.toHaveBeenCalled();
  });

  it('denied assets cannot invoke remote control', async () => {
    h.state.deniedIds.add(h.state.assetId);
    const response = await readRemoteControl();
    expect(response.status).toBe(404);
    expect(h.state.remoteControlUrl).not.toHaveBeenCalled();
  });

  it('applies API-key suppression before provider work', async () => {
    h.state.redactions.asset = ['values.asset_id'];
    h.state.keyOnly = true;
    const response = await readRemoteControl(true);
    expect(response.status).toBe(404);
    expect(h.state.remoteControlUrl).not.toHaveBeenCalled();
    expect(h.state.subjects.at(-1)?.apiKeyId).toBe('summary-key');
  });

  it.each(['assets.rmm_device_id', 'values.rmm_device_id', 'fields.assets.rmm_device_id'])(
    'redacts the returned URL when %s is hidden', async alias => {
      h.state.redactions.asset = [alias];
      const response = await readRemoteControl();
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ url: null, type: 'splashtop' });
      expect(h.state.remoteControlUrl).toHaveBeenCalledOnce();
    },
  );

  it('retains API-key redactions on the URL projection', async () => {
    h.state.redactions.asset = ['assets.rmm_device_id'];
    h.state.keyOnly = true;
    expect((await (await readRemoteControl()).json()).data.url).toBe('https://remote.example/device-1');
    const apiKeyResponse = await readRemoteControl(true);
    expect((await apiKeyResponse.json()).data.url).toBeNull();
    expect(h.state.subjects.at(-1)?.apiKeyId).toBe('summary-key');
  });

  it('preserves asset update authorization', async () => {
    h.state.assetUpdatePermission = false;
    const response = await readRemoteControl();
    expect(response.status).toBe(403);
    expect(h.state.remoteControlUrl).not.toHaveBeenCalled();
  });

  it('preserves Datto execute-command authorization', async () => {
    h.state.asset.rmm_provider = 'datto';
    h.state.rmmExecutePermission = false;
    const response = await readRemoteControl();
    expect(response.status).toBe(403);
    expect(h.state.remoteControlUrl).not.toHaveBeenCalled();
  });
});
