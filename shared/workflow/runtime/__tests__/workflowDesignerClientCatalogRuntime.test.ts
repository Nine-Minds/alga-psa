import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../jsonSchemaMetadata';
import { registerBusinessOperationsActionsV2 } from '../actions/registerBusinessOperationsActions';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { buildWorkflowDesignerActionCatalog, type WorkflowDesignerCatalogSourceAction } from '../designer/actionCatalog';

const EXPECTED_CLIENT_ACTION_IDS = [
  'clients.find',
  'clients.search',
  'clients.create',
  'clients.update',
  'clients.archive',
  'clients.delete',
  'clients.duplicate',
  'clients.add_tag',
  'clients.assign_to_ticket',
  'clients.add_note',
  'clients.add_interaction',
] as const;

describe('workflow designer client catalog grouping from runtime registrations', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('clients.add_interaction', 1)) {
      registerBusinessOperationsActionsV2();
    }
  });

  it('T002: groups runtime-registered clients.* actions under built-in Client group without catalog seed changes', () => {
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
    const clientRecord = catalog.find((record) => record.groupKey === 'client');

    expect(clientRecord).toBeDefined();
    expect(clientRecord?.label).toBe('Client');

    expect(clientRecord?.allowedActionIds).toEqual(expect.arrayContaining([...EXPECTED_CLIENT_ACTION_IDS]));
    expect(clientRecord?.allowedActionIds.length).toBeGreaterThanOrEqual(EXPECTED_CLIENT_ACTION_IDS.length);

    const clientActionIdsFromGroup = new Set(clientRecord?.actions.map((action) => action.id));
    for (const actionId of EXPECTED_CLIENT_ACTION_IDS) {
      expect(clientActionIdsFromGroup.has(actionId)).toBe(true);
    }
  });
});
