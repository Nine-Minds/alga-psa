import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../jsonSchemaMetadata';
import { registerBusinessOperationsActionsV2 } from '../actions/registerBusinessOperationsActions';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { buildWorkflowDesignerActionCatalog, type WorkflowDesignerCatalogSourceAction } from '../designer/actionCatalog';

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

describe('workflow designer crm catalog grouping from runtime registrations', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('crm.tag_activity', 1)) {
      registerBusinessOperationsActionsV2();
    }
  });

  it('T001: groups runtime-registered crm.* actions under built-in CRM group without catalog seed changes', () => {
    const registry = getActionRegistryV2();
    const sourceActions: WorkflowDesignerCatalogSourceAction[] = registry.list().map((action) => ({
      id: action.id,
      version: action.version,
      ui: action.ui,
      inputSchema: zodToWorkflowJsonSchema(action.inputSchema),
      outputSchema: zodToWorkflowJsonSchema(action.outputSchema),
    }));

    const catalog = buildWorkflowDesignerActionCatalog(sourceActions);
    const crmRecord = catalog.find((record) => record.groupKey === 'crm');

    expect(crmRecord).toBeDefined();
    expect(crmRecord?.label).toBe('CRM');
    expect(crmRecord?.allowedActionIds).toEqual(expect.arrayContaining([...EXPECTED_CRM_ACTION_IDS]));

    const crmActionsById = new Map(crmRecord?.actions.map((action) => [action.id, action]));
    expect(crmActionsById.get('crm.find_activities')?.label).toBe('Find CRM Activities');
    expect(crmActionsById.get('crm.create_interaction_type')?.label).toBe('Create Activity Type');
    expect(crmActionsById.get('crm.update_activity_status')?.label).toBe('Update Activity Status');
    expect(crmActionsById.get('crm.create_quote')?.label).toBe('Create Quote');
    expect(crmActionsById.get('crm.add_quote_item')?.label).toBe('Add Quote Item');
    expect(crmActionsById.get('crm.create_quote_from_template')?.label).toBe('Create Quote from Template');
    expect(crmActionsById.get('crm.find_quotes')?.label).toBe('Find Quotes');
    expect(crmActionsById.get('crm.submit_quote_for_approval')?.label).toBe('Submit Quote for Approval');
    expect(crmActionsById.get('crm.convert_quote')?.label).toBe('Convert Quote');
    expect(crmActionsById.get('crm.tag_activity')?.label).toBe('Tag CRM Activity');
  });
});
