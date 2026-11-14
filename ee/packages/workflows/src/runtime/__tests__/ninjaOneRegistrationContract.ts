import { beforeAll, describe, expect, it } from 'vitest';
import { getActionRegistryV2 } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';

const NINJAONE_ACTION_IDS = [
  'ninjaone.devices.find',
  'ninjaone.devices.sync',
  'ninjaone.devices.reboot',
  'ninjaone.devices.scripting_options',
  'ninjaone.devices.run_script',
  'ninjaone.alerts.list_active',
  'ninjaone.alerts.get',
  'ninjaone.alerts.reset'
] as const;

export function ninjaOneRegistrationContract(entry: string, initializeWorkflowRuntimeV2: () => void): void {
  describe(`NinjaOne workflow action registration (${entry})`, () => {
    const ninjaOneActions = () => getActionRegistryV2().list().filter((action) => action.id.startsWith('ninjaone.'));

    beforeAll(() => {
      // Each entrypoint runs in its own test file and starts with a fresh registry.
      expect(ninjaOneActions()).toEqual([]);
      initializeWorkflowRuntimeV2();
    });

    it('T006: runtime includes the eight NinjaOne workflow action IDs', () => {
      const actions = ninjaOneActions();
      const ids = actions.map((action) => action.id).sort();
      expect(ids).toEqual([...NINJAONE_ACTION_IDS].sort());
    });

    it('T007: NinjaOne action metadata exposes side-effect/idempotency and acknowledge-alert UI wording', () => {
      const actions = ninjaOneActions();
      const byId = new Map(actions.map((action) => [action.id, action]));

      expect(byId.get('ninjaone.devices.find')?.sideEffectful).toBe(false);
      expect(byId.get('ninjaone.alerts.list_active')?.sideEffectful).toBe(false);

      for (const id of ['ninjaone.devices.sync', 'ninjaone.devices.reboot', 'ninjaone.devices.run_script', 'ninjaone.alerts.reset'] as const) {
        expect(byId.get(id)?.sideEffectful).toBe(true);
        expect(byId.get(id)?.idempotency.mode).toBe('engineProvided');
      }

      const resetAction = byId.get('ninjaone.alerts.reset');
      expect(resetAction?.ui?.label).toBe('Acknowledge alert');
      expect(resetAction?.ui?.description).toContain('NinjaOne reset alert operation');
    });

    it('T014: NinjaOne actions expose input/output schemas for action.call configuration', () => {
      const actions = ninjaOneActions();
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

    it('reinitialization preserves the registered NinjaOne actions', () => {
      const registry = getActionRegistryV2();
      const actions = NINJAONE_ACTION_IDS.map((id) => registry.get(id, 1));
      initializeWorkflowRuntimeV2();
      expect(ninjaOneActions().map((action) => action.id).sort()).toEqual([...NINJAONE_ACTION_IDS].sort());
      NINJAONE_ACTION_IDS.forEach((id, index) => {
        expect(registry.get(id, 1)).toBe(actions[index]);
      });
    });
  });
}
