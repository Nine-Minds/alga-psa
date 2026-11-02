import { describe, expect, it, vi } from 'vitest';
import { TicketModel } from '../ticketModel';

// alga-2026-0002798: a client/contact author can never create an internal comment,
// whatever the parent thread is, and response_state keys off the stored visibility.

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (name: string) => conn(name),
    tenantJoin: (query: any, table: string, left: string, right: string) => query.join?.(table, left, right) ?? query,
  }),
}));

const tenant = '33333333-3333-3333-3333-333333333333';
const ticketId = '11111111-1111-1111-1111-111111111111';
const contactId = '22222222-2222-2222-2222-222222222222';
const userId = '44444444-4444-4444-4444-444444444444';
const parentCommentId = '55555555-5555-5555-5555-555555555555';
const parentThreadId = '66666666-6666-6666-6666-666666666666';

function harness(parentThreadIsInternal: boolean) {
  const insertedComments: any[] = [];
  const insertedThreads: any[] = [];
  const ticketUpdates: any[] = [];
  const threadUpdates: any[] = [];

  const parentBuilder: any = {
    where: vi.fn(() => parentBuilder),
    join: vi.fn(() => parentBuilder),
    select: vi.fn(() => parentBuilder),
    first: vi.fn(async () => ({
      comment_id: parentCommentId,
      ticket_id: ticketId,
      thread_id: parentThreadId,
      deleted_at: null,
      thread_is_internal: parentThreadIsInternal,
    })),
  };

  const trx: any = vi.fn((table: string) => {
    if (table === 'ticket_comment_attachments') return { where: () => ({ orderBy: () => ({ forUpdate: async () => [] }) }) };
    if (table === 'tickets') {
      return {
        where: vi.fn(() => ({
          first: vi.fn().mockResolvedValue({ ticket_id: ticketId }),
          update: vi.fn(async (data: any) => { ticketUpdates.push(data); return 1; }),
        })),
      };
    }
    if (table === 'contacts') return { where: () => ({ first: async () => ({ contact_name_id: contactId }) }) };
    if (table === 'comments as parent') return parentBuilder;
    if (table === 'comments') {
      return {
        insert: vi.fn(async (data: any) => { insertedComments.push(data); return [data]; }),
        where: () => ({ forUpdate: () => ({ first: async () => insertedComments.at(-1) }) }),
      };
    }
    if (table === 'comment_threads') {
      return {
        insert: vi.fn(async (data: any) => { insertedThreads.push(data); return [data]; }),
        where: vi.fn(() => ({ update: vi.fn(async (d: any) => { threadUpdates.push(d); return 1; }) })),
      };
    }
    if (table === 'tenant_settings') return { select: vi.fn(() => ({ first: vi.fn(async () => undefined) })) };
    throw new Error(`Unexpected table in unit test: ${table}`);
  });
  trx.isTransaction = true;
  trx.raw = vi.fn((sql: string) => sql);

  return { trx, insertedComments, insertedThreads, ticketUpdates, threadUpdates };
}

describe('TicketModel.createComment visibility inheritance (D1/D3)', () => {
  it('D1: a contact author replying to an internal-rooted parent stores a public top-level comment', async () => {
    const h = harness(true);

    const result = await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Customer reply',
        author_type: 'contact',
        contact_id: contactId,
        parent_comment_id: parentCommentId,
        is_internal: false,
      },
      tenant,
      h.trx
    );

    expect(h.insertedComments).toHaveLength(1);
    expect(h.insertedComments[0].is_internal).toBe(false);
    // Not attached to the internal thread: fresh public thread, no parent.
    expect(h.insertedComments[0].parent_comment_id).toBeNull();
    expect(h.insertedComments[0].thread_id).not.toBe(parentThreadId);
    expect(h.insertedThreads).toHaveLength(1);
    expect(h.insertedThreads[0]).toMatchObject({ is_internal: false, root_comment_id: h.insertedComments[0].comment_id });
    expect(h.threadUpdates).toHaveLength(0);
    expect(result.is_internal).toBe(false);
  });

  it('D1: an internal author replying to an internal-rooted parent still inherits internal', async () => {
    const h = harness(true);

    const result = await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Internal follow-up',
        author_type: 'internal',
        author_id: userId,
        parent_comment_id: parentCommentId,
        is_internal: false,
      },
      tenant,
      h.trx
    );

    expect(h.insertedComments[0].is_internal).toBe(true);
    expect(h.insertedComments[0].thread_id).toBe(parentThreadId);
    expect(h.insertedComments[0].parent_comment_id).toBe(parentCommentId);
    expect(result.is_internal).toBe(true);
    // An internal comment never flips response state.
    expect(h.ticketUpdates).toHaveLength(0);
  });

  it('D3: a contact reply to an internal parent sets awaiting_internal from the FINAL (public) visibility', async () => {
    const h = harness(true);

    await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Customer reply',
        author_type: 'contact',
        contact_id: contactId,
        parent_comment_id: parentCommentId,
        is_internal: false,
      },
      tenant,
      h.trx
    );

    expect(h.ticketUpdates).toContainEqual({ response_state: 'awaiting_internal' });
  });

  it('D3: a requested-public comment that is stored internal does not change response_state', async () => {
    const h = harness(true);

    await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Internal author, requested public, inherits internal',
        author_type: 'internal',
        author_id: userId,
        parent_comment_id: parentCommentId,
        is_internal: false,
      },
      tenant,
      h.trx
    );

    expect(h.insertedComments[0].is_internal).toBe(true);
    expect(h.ticketUpdates).toHaveLength(0);
  });
});
