import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventSchemas } from '@alga-psa/event-schemas';
import { buildWorkflowPayload } from '../workflow/workflowEventPublishHelpers';

const published: Array<{ eventType: string; payload: any; ctx: any }> = [];
vi.mock('../publishers', () => ({
  publishWorkflowEvent: async (e: any) => { published.push(e); },
}));
vi.mock('@alga-psa/db', () => ({ registerAfterCommit: () => undefined }));

import { ServerEventPublisher } from './serverEventPublisher';

const tenantId = randomUUID();
const ticketId = randomUUID();
const commentId = randomUUID();
const contactId = randomUUID();

const calls = (p: ServerEventPublisher, extra: Record<string, unknown>) => [
  () => p.publishTicketCreated({ tenantId, ticketId, ...extra }),
  () => p.publishTicketUpdated({ tenantId, ticketId, changes: { status_id: 'x' }, ...extra }),
  () => p.publishTicketClosed({ tenantId, ticketId, ...extra }),
  () => p.publishCommentCreated({ tenantId, ticketId, commentId, metadata: { comment: { id: commentId, content: 'c', author: 'a', isInternal: false } }, ...extra }),
];

// Mirror what publishWorkflowEvent does before the bus validates the event.
function parses(e: { eventType: string; payload: any; ctx: any }) {
  const payload = buildWorkflowPayload(e.payload, { ...e.ctx, occurredAt: new Date().toISOString() });
  return (EventSchemas as any)[e.eventType].parse({ id: randomUUID(), eventType: e.eventType, timestamp: new Date().toISOString(), payload });
}

describe('ServerEventPublisher actor guardrail', () => {
  beforeEach(() => { published.length = 0; });

  it('no actor: ctx SYSTEM, no payload.userId, payload parses', async () => {
    for (const call of calls(new ServerEventPublisher(), {})) await call();
    expect(published).toHaveLength(4);
    for (const e of published) {
      expect(e.payload, e.eventType).not.toHaveProperty('userId');
      expect(e.ctx.actor, e.eventType).toEqual({ actorType: 'SYSTEM' });
      const parsed = parses(e).payload;
      expect(parsed, e.eventType).not.toHaveProperty('userId');
    }
  });

  it('contact actor: ctx CONTACT, no payload.userId, payload parses', async () => {
    for (const call of calls(new ServerEventPublisher(), { actor: { actorType: 'CONTACT', actorContactId: contactId } })) await call();
    for (const e of published) {
      expect(e.payload, e.eventType).not.toHaveProperty('userId');
      expect(e.ctx.actor).toEqual({ actorType: 'CONTACT', actorContactId: contactId });
      expect(parses(e).payload).toMatchObject({ actorType: 'CONTACT', actorContactId: contactId });
    }
  });
});
