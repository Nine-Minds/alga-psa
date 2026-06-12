import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db/workDate', () => ({
  computeWorkDateFields: vi.fn(() => ({ localDate: '2026-01-01' })),
  resolveUserTimeZone: vi.fn(() => 'America/New_York')
}));

const NINJAONE_ACTION_IDS = [
  'ninjaone.devices.find',
  'ninjaone.devices.sync',
  'ninjaone.devices.reboot',
  'ninjaone.alerts.list_active',
  'ninjaone.alerts.get',
  'ninjaone.alerts.reset'
] as const;

const loadNinjaOneActions = async (entry: 'bootstrap' | 'worker') => {
  vi.resetModules();
  const runtime = await import(entry === 'bootstrap' ? '../bootstrap' : '../worker');
  const { getActionRegistryV2 } = await import('../../../../../../shared/workflow/runtime/registries/actionRegistry');
  runtime.initializeWorkflowRuntimeV2();
  return getActionRegistryV2().list().filter((action) => action.id.startsWith('ninjaone.'));
};

describe('NinjaOne workflow action runtime registration', () => {
  it('T006: bootstrap runtime includes the six NinjaOne workflow action IDs', async () => {
    const actions = await loadNinjaOneActions('bootstrap');
    const ids = actions.map((action) => action.id).sort();
    expect(ids).toEqual([...NINJAONE_ACTION_IDS].sort());
  });

  it('T006: worker runtime includes the same six NinjaOne workflow action IDs', async () => {
    const actions = await loadNinjaOneActions('worker');
    const ids = actions.map((action) => action.id).sort();
    expect(ids).toEqual([...NINJAONE_ACTION_IDS].sort());
  });

  it('T007: NinjaOne action metadata exposes side-effect/idempotency and acknowledge-alert UI wording', async () => {
    const actions = await loadNinjaOneActions('bootstrap');
    const byId = new Map(actions.map((action) => [action.id, action]));

    expect(byId.get('ninjaone.devices.find')?.sideEffectful).toBe(false);
    expect(byId.get('ninjaone.alerts.list_active')?.sideEffectful).toBe(false);

    for (const id of ['ninjaone.devices.sync', 'ninjaone.devices.reboot', 'ninjaone.alerts.reset'] as const) {
      expect(byId.get(id)?.sideEffectful).toBe(true);
      expect(byId.get(id)?.idempotency.mode).toBe('engineProvided');
    }

    const resetAction = byId.get('ninjaone.alerts.reset');
    expect(resetAction?.ui?.label).toBe('Acknowledge alert');
    expect(resetAction?.ui?.description).toContain('NinjaOne reset alert operation');
  });

  it('T014: NinjaOne actions expose input/output schemas for action.call configuration', async () => {
    const actions = await loadNinjaOneActions('bootstrap');
    const getAlert = actions.find((action) => action.id === 'ninjaone.alerts.get');
    const listActive = actions.find((action) => action.id === 'ninjaone.alerts.list_active');

    expect(getAlert).toBeDefined();
    expect(listActive).toBeDefined();
    expect(getAlert!.inputSchema.safeParse({ alert_uid: 'uid-1' }).success).toBe(true);
    expect(getAlert!.outputSchema.safeParse({
      alert: {
        alert_id: 'a1',
        external_alert_id: 'ext-a1',
        status: 'active',
        severity: 'high',
        priority: 'p1',
        title: 'Alert',
        message: 'CPU high',
        device_id: 'd1',
        asset_id: null,
        source_type: 'monitor',
        created_at: '2026-05-10T00:00:00.000Z',
        updated_at: '2026-05-10T00:01:00.000Z',
        acknowledged: false
      }
    }).success).toBe(true);
    expect(listActive!.outputSchema.safeParse({ alerts: [], count: 0 }).success).toBe(true);
  });
});
