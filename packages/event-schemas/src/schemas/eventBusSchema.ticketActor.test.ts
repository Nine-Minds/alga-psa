import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventSchemas } from './eventBusSchema';
import { resolveTicketEventActor, ticketEventActorFields, scrubLegacyTicketIdActor } from './workflowEventPublishHelpers';

const tenantId = randomUUID();
const ticketId = randomUUID();
const wrap = (eventType: string, payload: any) => ({ id: randomUUID(), eventType, timestamp: new Date().toISOString(), payload });

describe('ticket event actor schemas', () => {
  it.each(['TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_DELETED', 'TICKET_CREATED', 'TICKET_CLOSED'] as const)(
    '%s accepts a payload without userId and keeps actor fields',
    (type) => {
      const payload = { tenantId, ticketId, actorType: 'SYSTEM', comment: { id: randomUUID(), content: 'x', author: 'System' } };
      const parsed = (EventSchemas as any)[type].parse(wrap(type, payload)).payload;
      expect(parsed).not.toHaveProperty('userId');
      expect(parsed.actorType).toBe('SYSTEM');
    },
  );

  it('TICKET_UPDATED with flat changes and no userId keeps changes and actor fields', () => {
    const contactId = randomUUID();
    const parsed = (EventSchemas as any).TICKET_UPDATED.parse(wrap('TICKET_UPDATED', {
      tenantId, ticketId, actorType: 'CONTACT', actorContactId: contactId, changes: { status_id: 'a' },
    })).payload;
    expect(parsed).toMatchObject({ actorType: 'CONTACT', actorContactId: contactId, changes: { status_id: 'a' } });
    expect(parsed).not.toHaveProperty('userId');
  });

  it('TICKET_ASSIGNED still requires userId (the assignee) on the legacy branch', () => {
    expect(() => (EventSchemas as any).TICKET_ASSIGNED.parse(wrap('TICKET_ASSIGNED', { tenantId, ticketId }))).toThrow();
    expect(() => (EventSchemas as any).TICKET_ASSIGNED.parse(wrap('TICKET_ASSIGNED', { tenantId, ticketId, userId: randomUUID() }))).not.toThrow();
  });
});

describe('ticket actor helpers', () => {
  it('resolves USER, then CONTACT, then SYSTEM', () => {
    expect(resolveTicketEventActor({ userId: 'u', contactId: 'c' })).toEqual({ actorType: 'USER', actorUserId: 'u' });
    expect(resolveTicketEventActor({ contactId: 'c' })).toEqual({ actorType: 'CONTACT', actorContactId: 'c' });
    expect(resolveTicketEventActor({})).toEqual({ actorType: 'SYSTEM' });
  });

  it('emits userId only for a USER actor', () => {
    expect(ticketEventActorFields({ actorType: 'USER', actorUserId: 'u' })).toMatchObject({ userId: 'u', actorUserId: 'u', actorType: 'USER' });
    expect(ticketEventActorFields({ actorType: 'SYSTEM' })).not.toHaveProperty('userId');
    expect(ticketEventActorFields({ actorType: 'CONTACT', actorContactId: 'c' })).not.toHaveProperty('userId');
  });

  it('scrubs a ticket id used as an actor and leaves real actors alone', () => {
    const scrubbed = scrubLegacyTicketIdActor({ ticketId, userId: ticketId, actorType: 'USER', actorUserId: ticketId } as any) as any;
    expect(scrubbed).not.toHaveProperty('userId');
    expect(scrubbed).not.toHaveProperty('actorUserId');
    expect(scrubbed.actorType).toBe('SYSTEM');
    const real = { ticketId, userId: randomUUID() };
    expect(scrubLegacyTicketIdActor(real as any)).toBe(real);
  });
});
