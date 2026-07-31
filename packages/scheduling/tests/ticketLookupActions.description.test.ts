import { beforeEach, describe, expect, it, vi } from 'vitest';

const ticketRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('@alga-psa/db', () => {
  const query = {
    where: () => query,
    select: () => query,
    first: async () => ticketRow.current,
  };

  return {
    createTenantKnex: async () => ({ knex: {} }),
    tenantDb: () => ({ table: () => query, tenantJoin: () => undefined }),
    withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) =>
      callback({ raw: (sql: string) => sql }),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

import { getSchedulingTicketById } from '../src/actions/ticketLookupActions';

describe('getSchedulingTicketById description', () => {
  beforeEach(() => {
    ticketRow.current = null;
  });

  it('flattens serialized editor content instead of returning raw JSON', async () => {
    ticketRow.current = {
      ticket_id: 'ticket-1',
      attributes: {
        description: JSON.stringify([
          {
            id: '1',
            type: 'paragraph',
            props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
            content: [{ type: 'text', text: 'Printer jams', styles: {} }],
            children: [],
          },
          {
            id: '2',
            type: 'paragraph',
            props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
            content: [{ type: 'text', text: 'Only on duplex jobs', styles: {} }],
            children: [],
          },
        ]),
      },
    };

    const ticket = await getSchedulingTicketById('ticket-1');

    expect(ticket?.description).toBe('Printer jams\n\nOnly on duplex jobs');
  });

  it('returns null for an empty editor document', async () => {
    ticketRow.current = {
      ticket_id: 'ticket-1',
      attributes: {
        description: JSON.stringify([
          {
            id: '1',
            type: 'paragraph',
            props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
            content: [],
            children: [],
          },
        ]),
      },
    };

    const ticket = await getSchedulingTicketById('ticket-1');

    expect(ticket?.description).toBeNull();
  });
});
