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
] as const;

describe('workflow designer crm catalog grouping from runtime registrations', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('crm.send_quote', 1)) {
      registerBusinessOperationsActionsV2();
    }
  });

  it('T002: groups runtime-registered crm.* actions under built-in CRM group without catalog seed changes', () => {
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
    expect(crmActionsById.get('crm.update_activity')?.label).toBe('Update CRM Activity');
    expect(crmActionsById.get('crm.schedule_activity')?.label).toBe('Schedule CRM Activity');
    expect(crmActionsById.get('crm.send_quote')?.label).toBe('Send Quote');
  });
});
