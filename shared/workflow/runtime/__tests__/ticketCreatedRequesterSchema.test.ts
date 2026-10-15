import { describe, expect, it } from 'vitest';
import { getSchemaRegistry } from '../registries/schemaRegistry';
import { initializeWorkflowRuntimeV2 } from '../init';

const REF = 'payload.TicketCreated.v1';
const FIELDS = ['clientName', 'contactName', 'senderEmail', 'requesterName'];

describe('payload.TicketCreated.v1 requester identity', () => {
  it('is exposed to the designer payload picker and survives safeParse', () => {
    initializeWorkflowRuntimeV2();
    const registry = getSchemaRegistry();

    const json: any = registry.toJsonSchema(REF);
    const props = json.properties ?? json.definitions?.[REF]?.properties ?? {};
    for (const f of FIELDS) expect(Object.keys(props)).toContain(f);

    const payload = {
      tenantId: '22222222-2222-4222-8222-222222222222',
      occurredAt: '2026-10-05T12:00:00.000Z',
      ticketId: '33333333-3333-4333-8333-333333333333',
      clientName: 'Acme',
      contactName: 'Ada',
      senderEmail: 'ada@example.test',
      requesterName: 'Ada',
    };
    const parsed = registry.get(REF).safeParse(payload);
    expect(parsed.success).toBe(true);
    expect((parsed as any).data).toMatchObject({
      clientName: 'Acme', contactName: 'Ada', senderEmail: 'ada@example.test', requesterName: 'Ada',
    });
  });
});
