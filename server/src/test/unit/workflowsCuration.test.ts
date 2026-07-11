import { describe, expect, it } from 'vitest';
import { searchRegistryEntries } from '../../../../packages/agent-tooling/src/registry/search';
import ceRegistry from '../../lib/mcp/registry.generated';
import eeRegistry from '../../../../ee/server/src/chat/registry/apiRegistry.generated';

const PLACEHOLDER_DESCRIPTION =
  'This operation was generated automatically from the route inventory. Replace with canonical metadata.';

describe('workflow authoring registry curation (generated registries)', () => {
  it('surfaces the create-workflow endpoint first for "create a workflow"', () => {
    for (const registry of [ceRegistry, eeRegistry]) {
      const results = searchRegistryEntries(registry, 'create a workflow');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.id).toBe('post-_api_workflowdefinitions');
    }
  });

  it('carries the authoring playbooks on the create entry', () => {
    const create = ceRegistry.find((entry) => entry.id === 'post-_api_workflowdefinitions');
    expect(create).toBeDefined();
    expect(create?.playbooks?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(create?.playbooks?.join(' ')).toContain('/api/workflow/registry/authoring-guide');
    expect(create?.playbooks?.join(' ')).toContain('expectedDraftVersion');
  });

  it('includes the discovery endpoints the authoring loop depends on', () => {
    const ids = new Set(ceRegistry.map((entry) => entry.id));
    for (const required of [
      'post-_api_workflowdefinitions_validate',
      'post-_api_workflowdefinitions_simulate',
      'get-_api_workflow_registry_authoringguide',
      'get-_api_workflow_registry_events',
      'get-_api_workflow_registry_actions',
      'get-_api_workflow_registry_schemas_schemaref',
    ]) {
      expect(ids.has(required), `${required} should be in the generated registry`).toBe(true);
    }
  });

  it('contains no route-inventory placeholder entries', () => {
    for (const registry of [ceRegistry, eeRegistry]) {
      const placeholders = registry.filter((entry) => entry.description === PLACEHOLDER_DESCRIPTION);
      expect(placeholders.map((entry) => entry.id)).toEqual([]);
    }
  });
});
