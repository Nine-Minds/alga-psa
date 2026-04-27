import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerSchedulingActions } from '../businessOperations/scheduling';

const EXPECTED_SCHEDULING_ACTION_IDS = [
  'scheduling.assign_user',
  'scheduling.find_entry',
  'scheduling.search_entries',
  'scheduling.reschedule',
  'scheduling.reassign',
  'scheduling.cancel',
  'scheduling.complete',
] as const;

describe('scheduling workflow action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('scheduling.complete', 1)) {
      registerSchedulingActions();
    }
  });

  it('T001: registers scheduling read/write actions with expected metadata', () => {
    const registry = getActionRegistryV2();

    const actions = EXPECTED_SCHEDULING_ACTION_IDS.map((id) => {
      const action = registry.get(id, 1);
      expect(action, `${id}@1 should be registered`).toBeDefined();
      return action!;
    });

    const byId = new Map(actions.map((action) => [action.id, action]));

    expect(byId.get('scheduling.find_entry')?.sideEffectful).toBe(false);
    expect(byId.get('scheduling.search_entries')?.sideEffectful).toBe(false);
    expect(byId.get('scheduling.reschedule')?.sideEffectful).toBe(true);
    expect(byId.get('scheduling.reassign')?.sideEffectful).toBe(true);
    expect(byId.get('scheduling.cancel')?.sideEffectful).toBe(true);
    expect(byId.get('scheduling.complete')?.sideEffectful).toBe(true);

    expect(byId.get('scheduling.find_entry')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('scheduling.search_entries')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('scheduling.reschedule')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('scheduling.reassign')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('scheduling.cancel')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('scheduling.complete')?.idempotency.mode).toBe('engineProvided');
  });

  it('T002: validates representative schema success/failure cases and supports virtual recurring ids', () => {
    const registry = getActionRegistryV2();

    const find = registry.get('scheduling.find_entry', 1);
    const reschedule = registry.get('scheduling.reschedule', 1);
    const reassign = registry.get('scheduling.reassign', 1);
    const cancel = registry.get('scheduling.cancel', 1);
    const complete = registry.get('scheduling.complete', 1);

    if (!find || !reschedule || !reassign || !cancel || !complete) {
      throw new Error('Missing expected scheduling action registrations');
    }

    expect(find.inputSchema.safeParse({ entry_id: '00000000-0000-0000-0000-000000000001_1767225600000' }).success).toBe(true);
    expect(find.inputSchema.safeParse({ entry_id: '   ' }).success).toBe(false);

    expect(reschedule.inputSchema.safeParse({
      entry_id: '00000000-0000-0000-0000-000000000001',
      window: {
        start: '2026-05-01T10:00:00.000Z',
        end: '2026-05-01T11:00:00.000Z',
      },
      recurrence_scope: 'single',
      conflict_mode: 'fail',
    }).success).toBe(true);

    expect(reschedule.inputSchema.safeParse({
      entry_id: '00000000-0000-0000-0000-000000000001',
      window: {
        start: 'not-a-date',
        end: '2026-05-01T11:00:00.000Z',
      },
    }).success).toBe(false);

    expect(reschedule.inputSchema.safeParse({
      entry_id: '00000000-0000-0000-0000-000000000001',
      window: {
        start: '2026-05-01T10:00:00.000Z',
        end: '2026-05-01T11:00:00.000Z',
      },
      recurrence_scope: 'invalid',
    }).success).toBe(false);

    expect(reassign.inputSchema.safeParse({
      entry_id: '00000000-0000-0000-0000-000000000001',
      assigned_user_ids: [],
    }).success).toBe(false);

    expect(reassign.inputSchema.safeParse({
      entry_id: '00000000-0000-0000-0000-000000000001',
      assigned_user_ids: ['not-a-uuid'],
    }).success).toBe(false);

    expect(cancel.inputSchema.safeParse({
      entry_id: '00000000-0000-0000-0000-000000000001',
      recurrence_scope: 'all',
    }).success).toBe(true);

    expect(complete.inputSchema.safeParse({
      entry_id: '00000000-0000-0000-0000-000000000001',
      recurrence_scope: 'future',
      outcome: 'done',
    }).success).toBe(true);
  });

  it('T017: scheduling reassign/search schemas expose workflow picker metadata for user ids', () => {
    const registry = getActionRegistryV2();
    const reassign = registry.get('scheduling.reassign', 1);
    const search = registry.get('scheduling.search_entries', 1);

    expect(reassign).toBeDefined();
    expect(search).toBeDefined();

    if (!reassign || !search) {
      throw new Error('Missing scheduling actions for picker metadata assertion');
    }

    const reassignSchema = zodToWorkflowJsonSchema(reassign.inputSchema);
    const searchSchema = zodToWorkflowJsonSchema(search.inputSchema);

    const reassignProps = reassignSchema.properties as Record<string, any>;
    const searchProps = searchSchema.properties as Record<string, any>;

    expect(reassignProps.assigned_user_ids?.items?.['x-workflow-picker-kind']).toBe('user');
    expect(searchProps.assigned_user_ids?.items?.['x-workflow-picker-kind']).toBe('user');
  });
});
