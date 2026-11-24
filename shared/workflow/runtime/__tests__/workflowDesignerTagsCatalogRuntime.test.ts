import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '@alga-psa/event-schemas';
import { registerBusinessOperationsActionsV2 } from '../actions/registerBusinessOperationsActions';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { buildWorkflowDesignerActionCatalog, type WorkflowDesignerCatalogSourceAction } from '../designer/actionCatalog';

describe('workflow designer tags catalog grouping from runtime registrations', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('tags.add', 1)) {
      registerBusinessOperationsActionsV2();
    }
  });

  it('offers tags.add and tags.remove as a built-in Tags group, not an app group the palette hides without an installed app', () => {
    const sourceActions: WorkflowDesignerCatalogSourceAction[] = getActionRegistryV2().list().map((action) => ({
      id: action.id,
      version: action.version,
      ui: action.ui,
      inputSchema: zodToWorkflowJsonSchema(action.inputSchema),
      outputSchema: zodToWorkflowJsonSchema(action.outputSchema),
    }));

    const catalog = buildWorkflowDesignerActionCatalog(sourceActions);
    const tagsRecord = catalog.find((record) => record.groupKey === 'tags');

    expect(tagsRecord).toMatchObject({ label: 'Tags', tileKind: 'core-object', defaultActionId: 'tags.add' });
    expect(tagsRecord?.allowedActionIds).toEqual(['tags.add', 'tags.remove']);
    expect(tagsRecord?.actions.map((action) => action.label)).toEqual(['Add Tags', 'Remove Tags']);
    expect(catalog.some((record) => record.groupKey === 'app:tags')).toBe(false);
  });
});
