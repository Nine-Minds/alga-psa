import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let permissionGranted = true;
const adapterCalls: Array<{ op: string; ref: any }> = [];

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 'tenant_1' }, ...args),
  hasPermission: vi.fn(async () => permissionGranted),
}));

vi.mock('@alga-psa/db', () => {
  class QB {
    private filters: Row[] = [];
    constructor(private readonly table: string) {}
    where(w: Row) { this.filters.push(w); return this; }
    async first(cols?: any[]) {
      const rows = (tables[this.table] || []).filter((r) => this.filters.every((w) => Object.entries(w).every(([k, v]) => r[k] === v)));
      const row = rows[0];
      if (!row) return undefined;
      if (!cols) return row;
      const picked: Row = {};
      for (const c of cols) {
        if (typeof c === 'string') picked[c] = row[c];
        else if (c?.__raw) {
          const m = String(c.__raw).match(/^(\w+)(?: as (\w+))?$/);
          if (m) picked[m[2] ?? m[1]] = row[m[1]];
        }
      }
      return picked;
    }
  }
  const knex: any = {};
  knex.raw = (sql: string) => ({ __raw: sql });
  return {
    createTenantKnex: vi.fn(async () => ({ knex, tenant: 'tenant_1' })),
    tenantDb: (_conn: any, _tenant: string) => ({ table: (t: string) => new QB(t) }),
  };
});

vi.mock('@alga-psa/integrations/lib/rmm/assetDeviceActions', () => ({
  resolveRmmAssetDeviceActions: vi.fn(async (provider: string) =>
    provider === 'tacticalrmm'
      ? {
          refresh: async (ref: any) => { adapterCalls.push({ op: 'refresh', ref }); },
          reboot: async (ref: any) => {
            adapterCalls.push({ op: 'reboot', ref });
            if (ref.deviceId === 'OFFLINE') throw new Error('Unable to contact the agent');
          },
        }
      : null
  ),
}));

const workstation = {
  asset_id: 'asset_1', asset_type: 'workstation', name: 'pc-1',
  rmm_provider: 'tacticalrmm', rmm_device_id: 'AGENT-1', agent_status: 'online',
  last_seen_at: new Date('2026-09-09T11:58:00Z'), last_rmm_sync_at: new Date('2026-09-09T12:00:00Z'),
};

describe('asset RMM actions (provider dispatch)', () => {
  beforeEach(() => {
    permissionGranted = true;
    adapterCalls.length = 0;
    tables = {
      assets: [
        workstation,
        { asset_id: 'asset_lvl', asset_type: 'workstation', name: 'lvl-1', rmm_provider: 'levelio', rmm_device_id: 'dev-9', agent_status: 'online', last_seen_at: null, last_rmm_sync_at: null },
        { asset_id: 'asset_manual', asset_type: 'workstation', name: 'manual', rmm_provider: null, rmm_device_id: null, agent_status: null, last_seen_at: null, last_rmm_sync_at: null },
        { asset_id: 'asset_offline', asset_type: 'server', name: 'srv-1', rmm_provider: 'tacticalrmm', rmm_device_id: 'OFFLINE', agent_status: 'offline', last_seen_at: null, last_rmm_sync_at: null },
      ],
      workstation_assets: [
        { asset_id: 'asset_1', current_user: 'robin', uptime_seconds: 3600, lan_ip: '192.168.1.42', wan_ip: '203.0.113.9', cpu_utilization_percent: null, memory_usage_percent: null, memory_used_gb: null, ram_gb: 16, disk_usage: [{ name: 'C:', total_gb: 476.9, free_gb: 266.6, utilization_percent: 44 }] },
      ],
      server_assets: [],
    };
  });

  it('getAssetRmmData reads cached vitals from the extension table for any provider', async () => {
    const { getAssetRmmData } = await import('@alga-psa/assets/actions/rmmActions');
    const data = await getAssetRmmData('asset_1');
    expect(data).toMatchObject({
      provider: 'tacticalrmm',
      agent_status: 'online',
      last_check_in: '2026-09-09T11:58:00.000Z',
      current_user: 'robin',
      uptime_seconds: 3600,
      lan_ip: '192.168.1.42',
      memory_total_gb: 16,
    });
    expect(data?.storage).toEqual([{ name: 'C:', total_gb: 476.9, free_gb: 266.6, utilization_percent: 44 }]);
    expect(await getAssetRmmData('asset_manual')).toBeNull();
  });

  it('triggerRmmReboot dispatches to the provider adapter and reports its outcome', async () => {
    const { triggerRmmReboot } = await import('@alga-psa/assets/actions/rmmActions');
    expect(await triggerRmmReboot('asset_1')).toEqual({ success: true, message: 'Reboot command sent to pc-1' });
    expect(adapterCalls).toEqual([{ op: 'reboot', ref: { tenant: 'tenant_1', assetId: 'asset_1', deviceId: 'AGENT-1', assetName: 'pc-1' } }]);

    expect(await triggerRmmReboot('asset_offline')).toEqual({ success: false, message: 'Unable to contact the agent' });
  });

  it('refreshAssetRmmData refreshes through the adapter then re-reads cached data', async () => {
    const { refreshAssetRmmData } = await import('@alga-psa/assets/actions/rmmActions');
    const data = await refreshAssetRmmData('asset_1');
    expect(adapterCalls).toEqual([{ op: 'refresh', ref: expect.objectContaining({ deviceId: 'AGENT-1' }) }]);
    expect(data?.current_user).toBe('robin');
  });

  it('explains providers without device actions, unmanaged assets, and missing permission', async () => {
    const { refreshAssetRmmData, triggerRmmReboot } = await import('@alga-psa/assets/actions/rmmActions');
    await expect(refreshAssetRmmData('asset_lvl')).rejects.toThrow('Device actions are not available for Level assets');
    await expect(triggerRmmReboot('asset_manual')).rejects.toThrow('Asset is not managed by an RMM');
    await expect(triggerRmmReboot('missing')).rejects.toThrow('Asset not found');

    permissionGranted = false;
    await expect(triggerRmmReboot('asset_1')).rejects.toThrow('Permission denied');
    expect(adapterCalls).toEqual([]);
  });
});
