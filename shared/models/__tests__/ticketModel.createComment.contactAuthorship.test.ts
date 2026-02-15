import { describe, expect, it, vi } from 'vitest';
import { TicketModel } from '../ticketModel';

function createTrxHarness(options?: {
  ticketExists?: boolean;
  contactExists?: boolean;
}) {
  const ticketExists = options?.ticketExists ?? true;
  const contactExists = options?.contactExists ?? true;

  const insertedComments: any[] = [];
  const ticketUpdates: any[] = [];

  const commentsInsert = vi.fn(async (data: any) => {
    insertedComments.push(data);
    return [data];
  });

  const ticketsWhere = vi.fn(() => ({
    first: vi.fn().mockResolvedValue(ticketExists ? { ticket_id: '11111111-1111-1111-1111-111111111111' } : null),
    update: vi.fn(async (updateData: any) => {
      ticketUpdates.push(updateData);
      return 1;
    }),
  }));

  const contactsWhere = vi.fn(() => ({
    first: vi.fn().mockResolvedValue(
      contactExists ? { contact_name_id: '22222222-2222-2222-2222-222222222222' } : null
    ),
  }));

  const trx: any = vi.fn((table: string) => {
    if (table === 'tickets') {
      return { where: ticketsWhere };
    }
    if (table === 'contacts') {
      return { where: contactsWhere };
    }
    if (table === 'comments') {
      return { insert: commentsInsert };
    }
    throw new Error(`Unexpected table in TicketModel.createComment unit test: ${table}`);
  });

  return {
    trx,
    insertedComments,
    ticketUpdates,
  };
}

describe('TicketModel.createComment contact authorship', () => {
  const tenant = '33333333-3333-3333-3333-333333333333';
  const ticketId = '11111111-1111-1111-1111-111111111111';
  const contactId = '22222222-2222-2222-2222-222222222222';
  const userId = '44444444-4444-4444-4444-444444444444';

  it('T004: accepts author_type=contact with contact_id and no author_id', async () => {
    const { trx } = createTrxHarness();

    const result = await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Contact-authored comment',
        author_type: 'contact',
        contact_id: contactId,
      },
      tenant,
      trx
    );

    expect(result.comment_id).toBeDefined();
  });

  it('T005: rejects invalid contact_id format', async () => {
    const { trx } = createTrxHarness();

    await expect(
      TicketModel.createComment(
        {
          ticket_id: ticketId,
          content: 'Invalid contact id',
          author_type: 'contact',
          contact_id: 'not-a-uuid',
        },
        tenant,
        trx
      )
    ).rejects.toThrow('Contact ID must be a valid UUID');
  });

  it('T006: rejects contact_id that does not belong to tenant', async () => {
    const { trx } = createTrxHarness({ contactExists: false });

    await expect(
      TicketModel.createComment(
        {
          ticket_id: ticketId,
          content: 'Missing contact',
          author_type: 'contact',
          contact_id: contactId,
        },
        tenant,
        trx
      )
    ).rejects.toThrow('Contact not found or does not belong to tenant');
  });

  it('T007: persists contact_id on inserted comment row', async () => {
    const { trx, insertedComments } = createTrxHarness();

    await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Persist contact id',
        author_type: 'contact',
        contact_id: contactId,
      },
      tenant,
      trx
    );

    expect(insertedComments).toHaveLength(1);
    expect(insertedComments[0].contact_id).toBe(contactId);
    expect(insertedComments[0].user_id).toBeNull();
  });

  it('T008: persists both user_id and contact_id when both are provided', async () => {
    const { trx, insertedComments } = createTrxHarness();

    await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Persist both author ids',
        author_type: 'contact',
        author_id: userId,
        contact_id: contactId,
      },
      tenant,
      trx
    );

    expect(insertedComments).toHaveLength(1);
    expect(insertedComments[0].user_id).toBe(userId);
    expect(insertedComments[0].contact_id).toBe(contactId);
  });

  it('T009: contact-authored public comment sets response_state=awaiting_internal', async () => {
    const { trx, ticketUpdates } = createTrxHarness();

    await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Public contact reply',
        author_type: 'contact',
        contact_id: contactId,
        is_internal: false,
      },
      tenant,
      trx
    );

    expect(ticketUpdates).toContainEqual({ response_state: 'awaiting_internal' });
  });

  it('T010: contact-authored internal comment does not mutate response_state', async () => {
    const { trx, ticketUpdates } = createTrxHarness();

    await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: 'Internal contact note',
        author_type: 'contact',
        contact_id: contactId,
        is_internal: true,
      },
      tenant,
      trx
    );

    expect(ticketUpdates).toHaveLength(0);
  });
});
