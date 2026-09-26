import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventSchemas } from '@alga-psa/event-schemas';

// Tenant scoping is the real facade's concern; dispatch by table name here.
vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({ table: (name: string) => conn(name), tenantJoin: (query: any) => query }),
  getConnection: async () => { throw new Error('dispatch must reuse the supplied connection'); },
  registerAfterCommit: () => { throw new Error('dispatch must not register after-commit work'); },
}));

import { dispatchCommentPublication, resolveCommentAuthorDisplay } from '../ticketCommentAttachments';

function builder(row: any, updates: any[] = []) {
  const chain: any = {
    where: () => chain,
    whereNull: () => chain,
    select: () => chain,
    first: async () => row,
    update: async (data: any) => { updates.push(data); return 1; },
  };
  return chain;
}

function makeConn(rows: Record<string, any>, updates: any[] = []) {
  const conn: any = (name: string) => {
    if (!(name in rows)) throw new Error(`Unexpected table in comment author test: ${name}`);
    return builder(rows[name], updates);
  };
  conn.fn = { now: () => 'now()' };
  return conn;
}

const tenant = randomUUID();
const ticketId = randomUUID();
const commentId = randomUUID();

describe('resolveCommentAuthorDisplay', () => {
  it('prefers the contact, then the user, then the stored email sender', async () => {
    const metadata = { email: { fromName: 'Ada Lovelace', fromAddress: 'ada@example.test' } };
    const contactConn = makeConn({ contacts: { full_name: 'Grace Hopper' }, users: { first_name: 'Alan', last_name: 'Turing' } });
    expect(await resolveCommentAuthorDisplay(contactConn, tenant, { contact_id: randomUUID(), user_id: randomUUID(), metadata }))
      .toBe('Grace Hopper');

    const userConn = makeConn({ contacts: null, users: { first_name: 'Alan', last_name: 'Turing' } });
    expect(await resolveCommentAuthorDisplay(userConn, tenant, { user_id: randomUUID(), metadata })).toBe('Alan Turing');

    const senderConn = makeConn({});
    expect(await resolveCommentAuthorDisplay(senderConn, tenant, { metadata })).toBe('Ada Lovelace');
  });

  it('falls back through the address forms and finally to System', async () => {
    const conn = makeConn({});
    expect(await resolveCommentAuthorDisplay(conn, tenant, { metadata: { email: { fromAddress: 'ada@example.test' } } }))
      .toBe('ada@example.test');
    expect(await resolveCommentAuthorDisplay(conn, tenant, { metadata: { email: { matchedAddress: 'matched@example.test' } } }))
      .toBe('matched@example.test');
    // jsonb columns read back as objects, but a stringified column still resolves.
    expect(await resolveCommentAuthorDisplay(conn, tenant, { metadata: JSON.stringify({ email: { fromName: 'Ada' } }) }))
      .toBe('Ada');
    expect(await resolveCommentAuthorDisplay(conn, tenant, { metadata: null })).toBe('System');
    expect(await resolveCommentAuthorDisplay(conn, tenant, { metadata: { email: { fromName: '   ' } } })).toBe('System');
  });
});

describe('dispatchCommentPublication author self-heal', () => {
  const poisonRow = {
    comment_id: commentId,
    ticket_id: ticketId,
    user_id: null,
    note: '[]',
    is_internal: false,
    metadata: { email: { fromAddress: 'unmatched@example.test', fromName: 'Unmatched Sender' } },
    scheduled_publish_event_id: randomUUID(),
    // Persisted before the producer fix: no userId, no comment.author.
    comment_publication_payload: { tenantId: tenant, ticketId, commentId, comment: { id: commentId, content: '[]' } },
  };

  it('publishes a schema-valid event carrying the comment row sender', async () => {
    const updates: any[] = [];
    const conn = makeConn({ comments: poisonRow }, updates);
    const publish = vi.fn(async (_event: any, _options?: any) => undefined);

    await dispatchCommentPublication(conn, tenant, commentId, publish);

    const [event, options] = publish.mock.calls[0] as [any, any];
    expect(options.eventId).toBe(poisonRow.scheduled_publish_event_id);
    expect(event.payload).toMatchObject({ userId: ticketId, comment: { author: 'Unmatched Sender' } });
    expect(() => EventSchemas.TICKET_COMMENT_ADDED.parse({
      id: randomUUID(), timestamp: new Date().toISOString(), ...event,
    })).not.toThrow();
    expect(updates).toEqual([{ scheduled_publish_dispatched_at: 'now()' }]);
  });

  it('keeps an author and actor the producer already recorded', async () => {
    const userId = randomUUID();
    const conn = makeConn({ comments: {
      ...poisonRow, user_id: userId,
      comment_publication_payload: { ...poisonRow.comment_publication_payload, userId, comment: { id: commentId, content: '[]', author: 'Grace Hopper' } },
    } });
    const publish = vi.fn(async (_event: any, _options?: any) => undefined);

    await dispatchCommentPublication(conn, tenant, commentId, publish);

    expect((publish.mock.calls[0][0] as any).payload).toMatchObject({ userId, comment: { author: 'Grace Hopper' } });
  });
});
