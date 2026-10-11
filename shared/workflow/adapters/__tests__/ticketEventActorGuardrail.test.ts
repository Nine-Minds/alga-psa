import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventSchemas } from '@alga-psa/event-schemas';

// Captures every payload a publisher emits so one table can assert the actor contract.
const captured: Array<{ eventType: string; payload: any }> = [];

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: async (e: any) => { captured.push({ eventType: e.eventType, payload: e.payload }); },
  publishWorkflowEvent: async (e: any) => { captured.push({ eventType: e.eventType, payload: e.payload }); },
}));
vi.mock('@alga-psa/db', () => ({ registerAfterCommit: () => undefined }));
vi.mock('../../../services/email/inboundEmailDurableStore', () => ({
  insertOutboxRow: async (_trx: any, row: any) => { captured.push({ eventType: row.event_type, payload: row.payload }); },
}));

const tenantId = randomUUID();
const ticketId = randomUUID();
const commentId = randomUUID();
const contactId = randomUUID();
const userId = randomUUID();

async function publishers() {
  const { WorkflowEventPublisher } = await import('../workflowEventPublisher');
  const { InboundEmailOutboxEventPublisher } = await import('../inboundEmailOutboxEventPublisher');
  const { TicketModelEventPublisher } = await import('../../../services/tickets/ticketModelEventPublisher');
  return {
    WorkflowEventPublisher: new WorkflowEventPublisher(),
    InboundEmailOutboxEventPublisher: new InboundEmailOutboxEventPublisher({ trx: {} as any, tenantId, inboxId: randomUUID() } as any),
    TicketModelEventPublisher: new TicketModelEventPublisher(),
  };
}

const calls = (p: any, extra: Record<string, unknown>) => [
  () => p.publishTicketCreated({ tenantId, ticketId, ...extra }),
  () => p.publishTicketUpdated({ tenantId, ticketId, changes: { status_id: 'x' }, ...extra }),
  () => p.publishTicketClosed({ tenantId, ticketId, ...extra }),
  () => p.publishCommentCreated({ tenantId, ticketId, commentId, metadata: { content: 'c', author: 'a', isInternal: false }, ...extra }),
];

describe('ticket event actor guardrail', () => {
  beforeEach(() => { captured.length = 0; });

  for (const name of ['WorkflowEventPublisher', 'InboundEmailOutboxEventPublisher', 'TicketModelEventPublisher'] as const) {
    it(`${name}: no actor -> SYSTEM, never the ticket/tenant id as userId`, async () => {
      const p = (await publishers())[name];
      for (const call of calls(p, {})) await call();
      expect(captured).toHaveLength(4);
      for (const { eventType, payload } of captured) {
        expect(payload, eventType).not.toHaveProperty('userId');
        expect(payload.actorType, eventType).toBe('SYSTEM');
        expect(Object.values(payload)).not.toContain(null);
        expect(() => (EventSchemas as any)[eventType].parse({ id: randomUUID(), eventType, timestamp: new Date().toISOString(), payload: { occurredAt: new Date().toISOString(), ...payload } }), eventType).not.toThrow();
      }
    });

    it(`${name}: contact actor -> CONTACT with no userId`, async () => {
      const p = (await publishers())[name];
      for (const call of calls(p, { actor: { actorType: 'CONTACT', actorContactId: contactId } })) await call();
      for (const { eventType, payload } of captured) {
        expect(payload, eventType).not.toHaveProperty('userId');
        expect(payload).toMatchObject({ actorType: 'CONTACT', actorContactId: contactId });
      }
    });

    it(`${name}: real user -> userId and actorUserId`, async () => {
      const p = (await publishers())[name];
      for (const call of calls(p, { userId })) await call();
      for (const { payload } of captured) {
        expect(payload).toMatchObject({ userId, actorType: 'USER', actorUserId: userId });
      }
    });
  }
});
