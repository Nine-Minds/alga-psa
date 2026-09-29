import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventSchemas } from '@alga-psa/event-schemas';
import { TicketModel } from '../ticketModel';

// Same passthrough facade the sibling authorship test uses: tenant scoping is
// the real facade's concern, not this test's.
vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (name: string) => conn(name),
    tenantJoin: (query: any, table: string, left: string, right: string) => query.join?.(table, left, right) ?? query,
  }),
  getConnection: async () => { throw new Error('createComment must not open its own connection'); },
  registerAfterCommit: () => { throw new Error('createComment must not register after-commit work here'); },
}));

const tenant = '33333333-3333-3333-3333-333333333333';
const ticketId = '11111111-1111-1111-1111-111111111111';

function createTrxHarness() {
  const inserted: any[] = [];
  const commentUpdates: any[] = [];

  const trx: any = vi.fn((table: string) => {
    switch (table) {
      case 'tickets':
        return { where: () => ({ first: async () => ({ ticket_id: ticketId }), update: async () => 1 }) };
      case 'comment_threads':
        return { insert: async (data: any) => [data], where: () => ({ update: async () => 1 }) };
      case 'comments':
        return {
          insert: async (data: any) => { inserted.push(data); return [data]; },
          // Both the attachment reconciler and the publication intent read the
          // row back; the row is already published for an immediate comment.
          where: () => ({
            forUpdate: () => ({ first: async () => ({ ...inserted.at(-1), publish_state: 'published' }) }),
            update: async (data: any) => { commentUpdates.push(data); return 1; },
          }),
        };
      case 'ticket_comment_attachments':
        return { where: () => ({ orderBy: () => ({ forUpdate: async () => [] }) }) };
      default:
        throw new Error(`Unexpected table in createComment publication payload test: ${table}`);
    }
  });

  trx.isTransaction = true;
  trx.raw = vi.fn((sql: string) => sql);

  const persistedPayload = () => {
    const update = commentUpdates.find(row => row.comment_publication_payload);
    return JSON.parse(update.comment_publication_payload);
  };

  return { trx, inserted, persistedPayload };
}

function parseAsEvent(payload: unknown) {
  return EventSchemas.TICKET_COMMENT_ADDED.parse({
    id: randomUUID(),
    eventType: 'TICKET_COMMENT_ADDED',
    timestamp: new Date().toISOString(),
    payload,
  });
}

describe('TicketModel.createComment publication payload', () => {
  it('names the inbound sender when the comment matches no contact and no user', async () => {
    const { trx, persistedPayload } = createTrxHarness();

    await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Reply from an unmatched sender',
        metadata: { email: { fromName: 'Ada Lovelace', fromAddress: 'ada@example.test' } },
      },
      tenant,
      trx,
      { publishCommentCreated: vi.fn() } as any
    );

    const payload = persistedPayload();
    expect(payload.comment.author).toBe('Ada Lovelace');
    expect(payload.userId).toBe(ticketId);
    expect(() => parseAsEvent(payload)).not.toThrow();
  });

  it('falls back to the sender address when only an address was captured', async () => {
    const { trx, persistedPayload } = createTrxHarness();

    await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Reply with no display name',
        metadata: { email: { fromAddress: 'ada@example.test' } },
      },
      tenant,
      trx,
      { publishCommentCreated: vi.fn() } as any
    );

    const payload = persistedPayload();
    expect(payload.comment.author).toBe('ada@example.test');
    expect(() => parseAsEvent(payload)).not.toThrow();
  });

  it('persists a schema-valid System payload when no identity exists at all', async () => {
    const { trx, persistedPayload } = createTrxHarness();

    await TicketModel.createComment(
      { ticket_id: ticketId, content: 'Comment with no author at all' },
      tenant,
      trx,
      { publishCommentCreated: vi.fn() } as any
    );

    const payload = persistedPayload();
    expect(payload.comment.author).toBe('System');
    expect(payload.userId).toBe(ticketId);
    expect(parseAsEvent(payload).payload).toMatchObject({ userId: ticketId, comment: { author: 'System' } });
  });
});
