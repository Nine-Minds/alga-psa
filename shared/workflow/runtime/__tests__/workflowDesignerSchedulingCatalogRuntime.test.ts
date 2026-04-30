import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../jsonSchemaMetadata';
import { registerBusinessOperationsActionsV2 } from '../actions/registerBusinessOperationsActions';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { buildWorkflowDesignerActionCatalog, type WorkflowDesignerCatalogSourceAction } from '../designer/actionCatalog';

const EXPECTED_SCHEDULING_ACTION_IDS = [
  'scheduling.assign_user',
  'scheduling.find_entry',
  'scheduling.search_entries',
  'scheduling.reschedule',
  'scheduling.reassign',
  'scheduling.cancel',
  'scheduling.complete',
] as const;

describe('workflow designer scheduling catalog grouping from runtime registrations', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('scheduling.complete', 1)) {
      registerBusinessOperationsActionsV2();
    }
  });

  it('T001: groups runtime-registered scheduling.* actions under built-in Scheduling group without catalog seed changes', () => {
    const registry = getActionRegistryV2();
    const allRuntimeActions = registry.list();

    const sourceActions: WorkflowDesignerCatalogSourceAction[] = allRuntimeActions.map((action) => ({
      id: action.id,
      version: action.version,
      ui: action.ui,
      inputSchema: zodToWorkflowJsonSchema(action.inputSchema),
      outputSchema: zodToWorkflowJsonSchema(action.outputSchema),
    }));

    const catalog = buildWorkflowDesignerActionCatalog(sourceActions);
    const schedulingRecord = catalog.find((record) => record.groupKey === 'scheduling');

    expect(schedulingRecord).toBeDefined();
    expect(schedulingRecord?.label).toBe('Scheduling');

    expect(schedulingRecord?.allowedActionIds).toEqual(expect.arrayContaining([...EXPECTED_SCHEDULING_ACTION_IDS]));
    expect(schedulingRecord?.allowedActionIds.length).toBeGreaterThanOrEqual(EXPECTED_SCHEDULING_ACTION_IDS.length);

    const actionIdsFromGroup = new Set(schedulingRecord?.actions.map((action) => action.id));
    for (const actionId of EXPECTED_SCHEDULING_ACTION_IDS) {
      expect(actionIdsFromGroup.has(actionId)).toBe(true);
    }
  });
});
