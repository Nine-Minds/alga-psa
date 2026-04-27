import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../jsonSchemaMetadata';
import { registerBusinessOperationsActionsV2 } from '../actions/registerBusinessOperationsActions';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { buildWorkflowDesignerActionCatalog, type WorkflowDesignerCatalogSourceAction } from '../designer/actionCatalog';

const EXPECTED_CONTACT_ACTION_IDS = [
  'contacts.find',
  'contacts.search',
  'contacts.create',
  'contacts.update',
  'contacts.deactivate',
  'contacts.delete',
  'contacts.duplicate',
  'contacts.add_tag',
  'contacts.assign_to_ticket',
  'contacts.add_note',
  'contacts.add_interaction',
  'contacts.add_to_client',
  'contacts.move_to_client',
] as const;

describe('workflow designer contact catalog grouping from runtime registrations', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('contacts.move_to_client', 1)) {
      registerBusinessOperationsActionsV2();
    }
  });

  it('T001: groups runtime-registered contacts.* actions under built-in Contact group without catalog seed changes', () => {
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
    const contactRecord = catalog.find((record) => record.groupKey === 'contact');

    expect(contactRecord).toBeDefined();
    expect(contactRecord?.label).toBe('Contact');

    expect(contactRecord?.allowedActionIds).toEqual(expect.arrayContaining([...EXPECTED_CONTACT_ACTION_IDS]));
    expect(contactRecord?.allowedActionIds.length).toBeGreaterThanOrEqual(EXPECTED_CONTACT_ACTION_IDS.length);

    const contactActionIdsFromGroup = new Set(contactRecord?.actions.map((action) => action.id));
    for (const actionId of EXPECTED_CONTACT_ACTION_IDS) {
      expect(contactActionIdsFromGroup.has(actionId)).toBe(true);
    }
  });
});
