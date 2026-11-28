import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerTicketActions } from '../businessOperations/tickets';

const TICKET = '11111111-1111-4111-8111-111111111111';

describe('tickets.find_linked_entities registration', () => {
  registerTicketActions();
  const action = getActionRegistryV2().get('tickets.find_linked_entities', 1)!;

  it('is registered as a non-side-effectful Business Operations action', () => {
    expect(action).toBeTruthy();
    expect(action.sideEffectful).toBe(false);
    expect(action.ui?.category).toBe('Business Operations');
    expect(action.ui?.label).toBeTruthy();
  });

  it('applies defaults and rejects unknown entity types and oversized limits', () => {
    expect(action.inputSchema.parse({ ticket_id: TICKET })).toMatchObject({
      entity_type: 'all', include_external_ids: true, limit: 25, on_not_found: 'return_empty',
    });
    expect(() => action.inputSchema.parse({ ticket_id: TICKET, entity_type: 'client' })).toThrow();
    expect(() => action.inputSchema.parse({ ticket_id: TICKET, limit: 101 })).toThrow();
  });

  it('output schema carries name, relationship and external device ids for assets', () => {
    const parsed = action.outputSchema.parse({
      ticket_id: TICKET,
      links: [{
        entity_type: 'asset', entity_id: TICKET, name: 'PC', relationship_type: 'affected', linked_at: null,
        source: 'asset_associations',
        asset: { asset_id: TICKET, asset_tag: 'T', asset_name: 'PC', asset_type: 'workstation', client_id: null },
        external_ids: [{ integration_type: 'levelio', external_entity_id: 'dev-1', external_realm_id: null }],
      }],
    });
    expect(parsed.links[0].external_ids?.[0].external_entity_id).toBe('dev-1');
  });

  it('tickets.link_entities output now reports its source store', () => {
    const link = getActionRegistryV2().get('tickets.link_entities', 1)!;
    expect(Object.keys((link.outputSchema as any).shape)).toContain('source');
  });
});
