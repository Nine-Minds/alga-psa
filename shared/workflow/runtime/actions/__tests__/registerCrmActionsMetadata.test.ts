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
  'crm.create_interaction_type',
  'crm.update_activity_status',
  'crm.create_quote',
  'crm.add_quote_item',
  'crm.create_quote_from_template',
  'crm.find_quotes',
  'crm.submit_quote_for_approval',
  'crm.convert_quote',
  'crm.tag_activity',
] as const;

describe('crm workflow action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('crm.tag_activity', 1)) {
      registerCrmActions();
    }
  });

  it('T001: registers follow-up crm.* actions at version 1 while preserving first-pass actions', () => {
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

    expect(byId.get('crm.create_interaction_type')?.ui?.label).toBe('Create Activity Type');
    expect(byId.get('crm.update_activity_status')?.ui?.label).toBe('Update Activity Status');
    expect(byId.get('crm.create_quote')?.ui?.label).toBe('Create Quote');
    expect(byId.get('crm.add_quote_item')?.ui?.label).toBe('Add Quote Item');
    expect(byId.get('crm.create_quote_from_template')?.ui?.label).toBe('Create Quote from Template');
    expect(byId.get('crm.find_quotes')?.ui?.label).toBe('Find Quotes');
    expect(byId.get('crm.submit_quote_for_approval')?.ui?.label).toBe('Submit Quote for Approval');
    expect(byId.get('crm.convert_quote')?.ui?.label).toBe('Convert Quote');
    expect(byId.get('crm.tag_activity')?.ui?.label).toBe('Tag CRM Activity');

    expect(byId.get('crm.find_activities')?.sideEffectful).toBe(false);
    expect(byId.get('crm.find_quotes')?.sideEffectful).toBe(false);
    expect(byId.get('crm.create_quote')?.sideEffectful).toBe(true);

    expect(byId.get('crm.create_interaction_type')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('crm.add_quote_item')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('crm.create_quote_from_template')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('crm.find_quotes')?.idempotency.mode).toBe('engineProvided');
  });

  it('T002: follow-up crm action schemas expose picker metadata for supported uuid fields only', () => {
    const registry = getActionRegistryV2();

    const findActivities = registry.get('crm.find_activities', 1);
    const scheduleActivity = registry.get('crm.schedule_activity', 1);
    const createQuote = registry.get('crm.create_quote', 1);
    const createQuoteFromTemplate = registry.get('crm.create_quote_from_template', 1);

    expect(findActivities).toBeDefined();
    expect(scheduleActivity).toBeDefined();
    expect(createQuote).toBeDefined();
    expect(createQuoteFromTemplate).toBeDefined();

    if (!findActivities || !scheduleActivity || !createQuote || !createQuoteFromTemplate) {
      throw new Error('Missing expected CRM workflow actions');
    }

    const findSchema = zodToWorkflowJsonSchema(findActivities.inputSchema);
    const scheduleSchema = zodToWorkflowJsonSchema(scheduleActivity.inputSchema);
    const createQuoteSchema = zodToWorkflowJsonSchema(createQuote.inputSchema);
    const createQuoteFromTemplateSchema = zodToWorkflowJsonSchema(createQuoteFromTemplate.inputSchema);

    const findProps = findSchema.properties as Record<string, Record<string, unknown>>;
    const scheduleProps = scheduleSchema.properties as Record<string, Record<string, unknown>>;
    const createQuoteProps = createQuoteSchema.properties as Record<string, Record<string, unknown>>;
    const createQuoteFromTemplateProps = createQuoteFromTemplateSchema.properties as Record<string, Record<string, unknown>>;

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

    expect(createQuoteProps.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(createQuoteProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(createQuoteProps.contact_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);

    expect(createQuoteFromTemplateProps.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(createQuoteFromTemplateProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(createQuoteFromTemplateProps.contact_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);

    expect(createQuoteProps.quote_id?.['x-workflow-picker-kind']).toBeUndefined();
    expect(scheduleProps.type_id?.['x-workflow-picker-kind']).toBeUndefined();
    expect(scheduleProps.status_id?.['x-workflow-picker-kind']).toBeUndefined();
  });
});
