import { beforeEach, describe, expect, it, vi } from 'vitest';

const created: any[] = [];

vi.mock('@alga-psa/notifications/actions', () => ({
  createNotificationFromTemplateInternal: vi.fn(async (_db: any, req: any) => { created.push(req); }),
}));
vi.mock('../../../utils/notificationLinkResolver', () => ({
  resolveNotificationLinks: vi.fn(async () => ({ internalUrl: '/msp/tickets/x', portalUrl: null })),
}));
vi.mock('@alga-psa/db', async () => {
  const actual: any = await vi.importActual('@alga-psa/db').catch(() => ({}));
  return {
    ...actual,
    tenantDb: (conn: any) => ({ table: (name: string) => conn(name), tenantJoin: (q: any) => q }),
  };
});

import { internalNotificationSubscriberTestHarness } from '../internalNotificationSubscriber';

const { handleTicketCreated, handleTicketAssigned, handleTicketCommentAdded, handleTicketUpdated, handleTicketCommentUpdated } = internalNotificationSubscriberTestHarness;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const tenantId = 'd410d992-4e99-43e7-9390-f6b0ff744509';
const ticketId = '3ca189ae-1111-4222-8333-444455556666';
const assignee = '536065a8-1111-4222-8333-444455556666';

function fakeDb(rows: Record<string, any>) {
  const db: any = (table: string) => {
    const key = table.split(' as ')[0];
    const row = rows[key];
    const chain: any = {
      select: () => chain, where: () => chain, whereNotNull: () => chain, whereNot: () => chain, whereIn: () => chain, orderBy: () => chain,
      first: async () => row,
      then: (res: any) => res(Array.isArray(row) ? row : row ? [row] : []),
    };
    return chain;
  };
  db.raw = (sql: string) => sql;
  return db;
}

function rendered(req: any) {
  return JSON.stringify(req.data);
}

beforeEach(() => { created.length = 0; });

describe('ticket notification data never carries ids or empty names', () => {
  const baseTicket = { ticket_id: ticketId, ticket_number: 'T-1', title: 'Printer down', assigned_to: assignee, contact_name_id: null };

  it('email ticket with no contact and no client uses the sender email', async () => {
    const db = fakeDb({ tickets: { ...baseTicket, client_name: null, contact_name: null, email_metadata: { from: { email: 'who@example.test' } } } });
    await handleTicketCreated({ payload: { tenantId, ticketId, actorType: 'SYSTEM' } } as any, { db, propagateErrors: true });
    expect(created[0].data.clientName).toBe('who@example.test');
    expect(rendered(created[0])).not.toMatch(UUID);
  });

  it('portal ticket with a contact but unmatched client names the contact', async () => {
    const db = fakeDb({ tickets: { ...baseTicket, client_name: null, contact_name: 'Grace Hopper', contact_email: 'g@example.test' } });
    await handleTicketCreated({ payload: { tenantId, ticketId, userId: assignee } } as any, { db, propagateErrors: true });
    expect(created[0].data.clientName).toBe('Grace Hopper');
  });

  it('falls back to a word, never an empty string, when nothing is known', async () => {
    const db = fakeDb({ tickets: { ...baseTicket, client_name: '', contact_name: null } });
    await handleTicketCreated({ payload: { tenantId, ticketId, actorType: 'SYSTEM' } } as any, { db, propagateErrors: true });
    expect(created[0].data.clientName).toBe('Unknown');
  });

  it('assignment with a missing or nameless actor renders "Someone", not "null null"', async () => {
    const db = fakeDb({
      tickets: { ticket_number: 'T-1', title: 'x', assigned_to: assignee, priority: 'High' },
      users: { first_name: null, last_name: null },
    });
    await handleTicketAssigned({ payload: { tenantId, ticketId, userId: assignee, assignedByUserId: assignee } } as any, { db, propagateErrors: true });
    expect(created.length).toBeGreaterThan(0);
    for (const req of created) expect(req.data.performedByName ?? 'Someone').toBe('Someone');
  });

  it('comment with no user row uses the sender, and ignores an id posing as the author', async () => {
    const db = fakeDb({ tickets: { ...baseTicket }, users: undefined });
    await handleTicketCommentAdded({ payload: { tenantId, ticketId, actorType: 'SYSTEM', comment: { id: ticketId, content: '', author: 'who@example.test' } } } as any, { db, propagateErrors: true });
    const names = created.map((r) => r.data.commentAuthor ?? r.data.authorName).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n === 'who@example.test')).toBe(true);

    created.length = 0;
    await handleTicketCommentAdded({ payload: { tenantId, ticketId, actorType: 'SYSTEM', comment: { id: ticketId, content: '', author: ticketId } } } as any, { db, propagateErrors: true });
    const ids = created.map((r) => r.data.commentAuthor ?? r.data.authorName).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((n) => n === 'System')).toBe(true);
  });
});

describe('ticket events with no userId (nobody acted) do not throw and name no raw id', () => {
  const baseTicket = { ticket_id: ticketId, ticket_number: 'T-1', title: 'Printer down', assigned_to: assignee, contact_name_id: null };
  const noUserPayload = { tenantId, ticketId, actorType: 'SYSTEM' };

  it('TICKET_UPDATED notifies the assignee and names the performer "System"', async () => {
    const db = fakeDb({ tickets: { ...baseTicket, client_name: null, contact_name: null } });
    await handleTicketUpdated({ payload: { ...noUserPayload, changes: { title: { old: 'a', new: 'b' } } } } as any, { db, propagateErrors: true });
    expect(created.length).toBeGreaterThan(0);
    for (const req of created) {
      expect(req.data.performedByName ?? 'System').toBe('System');
      expect(req.metadata ?? {}).not.toHaveProperty('performedById');
      expect(rendered(req)).not.toContain(ticketId + '"');
    }
  });

  it('TICKET_COMMENT_ADDED falls back to comment.author, then System, and writes no author ids', async () => {
    const db = fakeDb({ tickets: { ...baseTicket }, users: undefined });
    await handleTicketCommentAdded({ payload: { ...noUserPayload, comment: { id: ticketId, content: '', author: 'who@example.test' } } } as any, { db, propagateErrors: true });
    expect(created.length).toBeGreaterThan(0);
    for (const req of created) {
      expect(req.data.commentAuthor ?? req.data.authorName).toBe('who@example.test');
      expect(req.metadata ?? {}).not.toHaveProperty('commentAuthorId');
      expect(req.data.comment ?? {}).not.toHaveProperty('authorId');
    }
  });

  it('TICKET_COMMENT_UPDATED with a mention and no userId creates the notification as System', async () => {
    const mentioned = '99999999-1111-4222-8333-444455556666';
    const content = JSON.stringify([{ type: 'paragraph', content: [{ type: 'mention', props: { userId: mentioned, displayName: 'Ada' } }] }]);
    const db = fakeDb({ tickets: { ...baseTicket }, users: { user_id: mentioned, first_name: 'Ada', last_name: 'L' } });
    await handleTicketCommentUpdated({ payload: { ...noUserPayload, oldComment: { id: ticketId, content: '[]', author: 'x' }, newComment: { id: ticketId, content, author: 'x' } } } as any, { db, propagateErrors: true });
    expect(created.length).toBeGreaterThan(0);
    for (const req of created) {
      expect(req.data.commentAuthor ?? req.data.authorName).toBe('x');
      expect(req.metadata ?? {}).not.toHaveProperty('commentAuthorId');
    }
  });
});

