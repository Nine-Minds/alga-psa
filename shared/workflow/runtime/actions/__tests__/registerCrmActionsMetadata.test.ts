import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerCrmActions } from '../businessOperations/crm';

const EXPECTED_CRM_ACTION_IDS = [
  'crm.create_activity_note',
  'crm.find_activities',
  'crm.update_activity',
  'crm.schedule_activity',
  'crm.send_quote',
] as const;

describe('crm workflow action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('crm.send_quote', 1)) {
      registerCrmActions();
    }
  });

  it('T001: registers new crm.* actions at version 1 while preserving crm.create_activity_note', () => {
    const registry = getActionRegistryV2();

    const actions = EXPECTED_CRM_ACTION_IDS.map((id) => {
      const action = registry.get(id, 1);
      expect(action, `${id}@1 should be registered`).toBeDefined();
      return action!;
    });

    const byId = new Map(actions.map((action) => [action.id, action]));

    expect(byId.get('crm.create_activity_note')?.ui?.label).toBe('Create Activity Note');
    expect(byId.get('crm.find_activities')?.ui?.label).toBe('Find CRM Activities');
    expect(byId.get('crm.update_activity')?.ui?.label).toBe('Update CRM Activity');
    expect(byId.get('crm.schedule_activity')?.ui?.label).toBe('Schedule CRM Activity');
    expect(byId.get('crm.send_quote')?.ui?.label).toBe('Send Quote');

    expect(byId.get('crm.find_activities')?.sideEffectful).toBe(false);
    expect(byId.get('crm.update_activity')?.sideEffectful).toBe(true);
    expect(byId.get('crm.schedule_activity')?.sideEffectful).toBe(true);
    expect(byId.get('crm.send_quote')?.sideEffectful).toBe(true);

    expect(byId.get('crm.find_activities')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('crm.update_activity')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('crm.schedule_activity')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('crm.send_quote')?.idempotency.mode).toBe('engineProvided');
  });

  it('T003: crm action schemas expose picker metadata for supported uuid fields only', () => {
    const registry = getActionRegistryV2();

    const findActivities = registry.get('crm.find_activities', 1);
    const scheduleActivity = registry.get('crm.schedule_activity', 1);

    expect(findActivities).toBeDefined();
    expect(scheduleActivity).toBeDefined();

    if (!findActivities || !scheduleActivity) {
      throw new Error('Missing expected CRM workflow actions');
    }

    const findSchema = zodToWorkflowJsonSchema(findActivities.inputSchema);
    const scheduleSchema = zodToWorkflowJsonSchema(scheduleActivity.inputSchema);

    const findProps = findSchema.properties as Record<string, Record<string, unknown>>;
    const scheduleProps = scheduleSchema.properties as Record<string, Record<string, unknown>>;

    expect(findProps.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(findProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(findProps.contact_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);
    expect(findProps.ticket_id?.['x-workflow-picker-kind']).toBe('ticket');
    expect(findProps.user_id?.['x-workflow-picker-kind']).toBe('user');

    expect(scheduleProps.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(scheduleProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(scheduleProps.contact_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);
    expect(scheduleProps.ticket_id?.['x-workflow-picker-kind']).toBe('ticket');
    expect(scheduleProps.assigned_user_id?.['x-workflow-picker-kind']).toBe('user');
    expect(scheduleProps.owner_user_id?.['x-workflow-picker-kind']).toBe('user');

    expect(scheduleProps.type_id?.['x-workflow-picker-kind']).toBeUndefined();
    expect(scheduleProps.status_id?.['x-workflow-picker-kind']).toBeUndefined();
  });
});
