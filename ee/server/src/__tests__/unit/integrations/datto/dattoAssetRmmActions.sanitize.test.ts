import { beforeEach, describe, expect, it, vi } from 'vitest';

let thrown: unknown;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 'tenant_1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', () => {
  const q: any = {};
  q.where = () => q;
  q.first = async () => ({
    asset_type: 'workstation',
    name: 'dt-1',
    rmm_provider: 'datto',
    rmm_device_id: 'DEV-UID-1',
    agent_status: 'online',
    last_seen_at: null,
    last_rmm_sync_at: null,
  });
  return {
    createTenantKnex: vi.fn(async () => ({ knex: {} })),
    tenantDb: () => ({ table: () => q }),
  };
});

vi.mock('@alga-psa/integrations/lib/rmm/assetDeviceActions', () => ({
  resolveRmmAssetDeviceActions: vi.fn(async () => ({
    refresh: async () => undefined,
    reboot: async () => { throw thrown; },
    runScript: async () => { throw thrown; },
  })),
}));

const operatorError = () => Object.assign(new Error('Configure a reboot component in Datto RMM settings before rebooting from Alga.'), { name: 'DattoActionError' });

describe('asset RMM actions: Datto error sanitizing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('never returns the message of an unknown error for a datto asset', async () => {
    const { triggerRmmReboot, triggerRmmScript } = await import('@alga-psa/integrations/actions/integrations/assetRmmActions');
    thrown = new Error('connect ECONNREFUSED 10.0.0.5:5432 (knex) secret provider token=abc');

    const reboot = await triggerRmmReboot('asset_datto');
    expect(reboot.success).toBe(false);
    expect(reboot.message).not.toMatch(/ECONNREFUSED|knex|token/);
    expect(reboot.message).toMatch(/^Unable to send reboot command/);

    const script = await triggerRmmScript('asset_datto', 'comp-1');
    expect(script.success).toBe(false);
    expect(script.message).not.toMatch(/ECONNREFUSED|knex|token/);
    expect(script.message).toMatch(/^Unable to run script/);
  });

  it('passes through messages written for the operator (DattoActionError)', async () => {
    const { triggerRmmReboot, triggerRmmScript } = await import('@alga-psa/integrations/actions/integrations/assetRmmActions');
    thrown = operatorError();
    expect((await triggerRmmReboot('asset_datto')).message).toMatch(/^Configure a reboot component/);
    expect((await triggerRmmScript('asset_datto', 'comp-1')).message).toMatch(/^Configure a reboot component/);
  });
});
