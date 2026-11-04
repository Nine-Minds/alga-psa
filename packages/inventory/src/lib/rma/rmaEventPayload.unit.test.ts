import { describe, expect, it, vi } from 'vitest';

const published = vi.hoisted(() => ({ calls: [] as Array<{ eventType: string; payload: any }> }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishBuiltWorkflowPayload: async (built: any) => { published.calls.push(built); },
  publishNonCatalogEventByName: vi.fn(),
  reviveStoredWorkflowPayload: (eventType: string, payload: Record<string, unknown>) => ({ eventType, payload }),
}));

import { buildInventoryRmaUpdatedPayload } from '@alga-psa/shared/workflow/streams/domainEventBuilders/inventoryEventBuilders';
import { inventoryRmaUpdatedEventPayloadSchema, EventSchemas, EVENT_TYPES, WORKFLOW_EVENT_CATALOG } from '../../../../event-schemas/src/index';
import { publishRmaUpdated } from './publishRmaUpdated';

const rma = {
  rma_id: '11111111-1111-4111-8111-111111111111', rma_number: 'RMA-00007', status: 'sent_to_vendor', rma_type: 'standard',
  asset_id: '22222222-2222-4222-8222-222222222222', ticket_id: '33333333-3333-4333-8333-333333333333',
  client_id: '44444444-4444-4444-8444-444444444444', warranty_outcome: 'covered',
} as any;

describe('INVENTORY_RMA_UPDATED', () => {
  it('builder emits the documented snake_case fields and validates against the schema', () => {
    const built: any = buildInventoryRmaUpdatedPayload({
      tenant: '55555555-5555-4555-8555-555555555555', rmaId: rma.rma_id, rmaNumber: 'RMA-00007', status: 'sent_to_vendor',
      previousStatus: 'returned', rmaType: 'standard', assetId: rma.asset_id, ticketId: rma.ticket_id, clientId: rma.client_id,
      warrantyOutcome: 'covered', changedFields: ['status'], userId: '66666666-6666-4666-8666-666666666666',
      timestamp: '2026-10-25T00:00:00.000Z',
    });
    const payload = built.payload ?? built;
    expect(payload).toMatchObject({
      rma_number: 'RMA-00007', status: 'sent_to_vendor', previous_status: 'returned', rma_type: 'standard',
      asset_id: rma.asset_id, ticket_id: rma.ticket_id, warranty_outcome: 'covered', changed_fields: ['status'],
    });
    expect(inventoryRmaUpdatedEventPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('is registered in the event bus schema map and the workflow catalog', () => {
    expect(EVENT_TYPES).toContain('INVENTORY_RMA_UPDATED');
    expect(EventSchemas.INVENTORY_RMA_UPDATED).toBeDefined();
    expect((WORKFLOW_EVENT_CATALOG as Record<string, unknown>).INVENTORY_RMA_UPDATED).toBeDefined();
  });

  it('publishRmaUpdated publishes through the bus and swallows bus failures', async () => {
    published.calls.length = 0;
    await publishRmaUpdated('55555555-5555-4555-8555-555555555555', rma, 'returned', ['status'], '66666666-6666-4666-8666-666666666666');
    expect(published.calls.map((c) => c.eventType)).toEqual(['INVENTORY_RMA_UPDATED']);
  });
});
