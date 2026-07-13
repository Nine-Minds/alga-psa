import { describe, expect, it } from 'vitest';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerOpportunityActions } from '../businessOperations/opportunities';
import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';

describe('opportunity workflow actions', () => {
  it('registers all four runtime actions with validation and Designer metadata', () => {
    registerOpportunityActions();
    const registry = getActionRegistryV2();
    const ids = [
      'opportunities.create',
      'opportunities.find',
      'opportunities.update',
      'opportunities.set_next_action',
    ];

    for (const id of ids) {
      const action = registry.get(id, 1);
      expect(action, id).toBeDefined();
      expect(action?.ui?.category).toBe('Business Operations');
    }

    const create = registry.get('opportunities.create', 1)!;
    expect(create.inputSchema.safeParse({ title: 'Missing required context' }).success).toBe(false);

    const update = registry.get('opportunities.update', 1)!;
    expect(update.inputSchema.safeParse({
      opportunity_id: '11111111-1111-4111-8111-111111111111',
      patch: { status: 'won' },
    }).success).toBe(false);

    const schema = zodToWorkflowJsonSchema(create.inputSchema) as any;
    expect(schema.properties.client_id['x-workflow-picker-kind']).toBe('client');
    expect(schema.properties.contact_id['x-workflow-picker-dependencies']).toEqual(['client_id']);
  });
});
