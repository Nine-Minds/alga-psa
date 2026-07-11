import { beforeAll, describe, expect, it, vi } from 'vitest';

// The activity-group cores live behind the user-activities server barrel,
// which drags next-auth into the module graph; these tests only exercise
// registration metadata and input schemas, so stub the barrel.
vi.mock('@alga-psa/user-activities/server/activity-actions', () => ({
  getUserActivityGroupsForApi: vi.fn(),
  moveActivityToGroupForApi: vi.fn(),
  removeActivityFromGroupsForApi: vi.fn(),
}));

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerActivityActions } from '../businessOperations/activities';

const EXPECTED_ACTIVITY_ACTION_IDS = [
  'activities.find_group',
  'activities.add_to_group',
  'activities.remove_from_group',
] as const;

describe('activity workflow action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('activities.find_group', 1)) {
      registerActivityActions();
    }
  });

  it('registers the activity-group trio with expected metadata', () => {
    const registry = getActionRegistryV2();

    const actions = EXPECTED_ACTIVITY_ACTION_IDS.map((id) => {
      const action = registry.get(id, 1);
      expect(action, `${id}@1 should be registered`).toBeDefined();
      return action!;
    });

    const byId = new Map(actions.map((action) => [action.id, action]));
    expect(byId.get('activities.find_group')?.sideEffectful).toBe(false);
    expect(byId.get('activities.add_to_group')?.sideEffectful).toBe(true);
    expect(byId.get('activities.remove_from_group')?.sideEffectful).toBe(true);

    for (const action of actions) {
      expect(action.idempotency.mode).toBe('engineProvided');
      expect(action.ui?.label?.length ?? 0).toBeGreaterThan(0);
      expect(action.ui?.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('requires a group selector and validates input shapes', () => {
    const registry = getActionRegistryV2();
    const findGroup = registry.get('activities.find_group', 1)!;
    const addToGroup = registry.get('activities.add_to_group', 1)!;

    expect(findGroup.inputSchema.safeParse({}).success).toBe(false);
    expect(findGroup.inputSchema.safeParse({ groupName: 'important' }).success).toBe(true);
    expect(
      findGroup.inputSchema.safeParse({
        groupId: '2c1b3f74-1111-4222-8333-444455556666',
        ownerUserId: '2c1b3f74-1111-4222-8333-444455557777',
      }).success
    ).toBe(true);

    expect(
      addToGroup.inputSchema.safeParse({
        activityId: '2c1b3f74-1111-4222-8333-444455556666',
        activityType: 'ticket',
      }).success
    ).toBe(false);
    expect(
      addToGroup.inputSchema.safeParse({
        activityId: '2c1b3f74-1111-4222-8333-444455556666',
        activityType: 'ticket',
        groupName: 'important',
      }).success
    ).toBe(true);
  });

  it('marks ownerUserId with the user picker metadata', () => {
    const registry = getActionRegistryV2();
    const findGroup = registry.get('activities.find_group', 1)!;
    const json = zodToWorkflowJsonSchema(findGroup.inputSchema, { name: 'activities.find_group.input' });
    const text = JSON.stringify(json);
    expect(text).toContain('x-workflow-picker-kind');
    expect(text).toContain('"user"');
  });
});
