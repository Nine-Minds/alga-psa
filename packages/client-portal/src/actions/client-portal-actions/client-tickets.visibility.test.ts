import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const hasPermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const getVisibilityContextMock = vi.fn();
const applyVisibilityBoardFilterMock = vi.fn((query) => query);
const createTicketWithRetryMock = vi.fn();
const publishEventMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
}));

vi.mock('@alga-psa/tickets/lib', () => ({
  applyVisibilityBoardFilter: (...args: any[]) => applyVisibilityBoardFilterMock(...args),
  getClientContactVisibilityContext: (...args: any[]) => getVisibilityContextMock(...args),
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: {
    createTicketWithRetry: (...args: any[]) => createTicketWithRetryMock(...args),
  },
}));

vi.mock('@alga-psa/event-bus', () => ({
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  ServerAnalyticsTracker: class {},
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));

vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
}));

function makeConnection() {
  return Object.assign(vi.fn(), {
    raw: vi.fn(),
  });
}

function makeUserQuery(contactId = 'contact-1') {
  return {
    where: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue({ user_id: currentUser.user_id, contact_id: contactId }),
    }),
  };
}

function makeListBuilder(rows: any[]) {
  return {
    select: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
}

function makeDetailBuilder(ticket: any) {
  return {
    select: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    modify: vi.fn(function(callback: (query: any) => void) {
      callback(this);
      return this;
    }),
    first: vi.fn().mockResolvedValue(ticket),
  };
}

describe('client portal ticket visibility enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      email: 'client@example.com',
      tenant: 'tenant-1',
    };
    hasPermissionMock.mockResolvedValue(true);
    getConnectionMock.mockResolvedValue(makeConnection());
    createTenantKnexMock.mockResolvedValue({ knex: {} as any });
  });

  it('T008: client portal ticket list applies the assigned visibility group boards', async () => {
    const ticketsBuilder = makeListBuilder([
      {
        ticket_id: 'ticket-1',
        entered_at: '2026-03-15T00:00:00.000Z',
        updated_at: '2026-03-15T00:00:00.000Z',
        closed_at: null,
      },
    ]);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'users') {
          return makeUserQuery();
        }

        if (table === 'tickets as t') {
          return ticketsBuilder;
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-1'],
    });

    const { getClientTickets } = await import('./client-tickets');
    await getClientTickets('all');

    expect(applyVisibilityBoardFilterMock).toHaveBeenCalledWith(
      ticketsBuilder,
      ['board-1']
    );
  });

  it('T009: client portal ticket list stays unrestricted when no visibility group is assigned', async () => {
    const ticketsBuilder = makeListBuilder([]);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'users') {
          return makeUserQuery();
        }

        if (table === 'tickets as t') {
          return ticketsBuilder;
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: null,
      visibleBoardIds: null,
    });

    const { getClientTickets } = await import('./client-tickets');
    await getClientTickets('all');

    expect(applyVisibilityBoardFilterMock).toHaveBeenCalledWith(
      ticketsBuilder,
      null
    );
  });

  it('T010: client portal ticket detail succeeds for a ticket on a visible board', async () => {
    const ticketBuilder = makeDetailBuilder({
      ticket_id: 'ticket-1',
      ticket_number: 'T-1',
      title: 'Visible ticket',
      board_id: 'board-1',
      client_id: 'client-1',
      entered_by_user_type: 'internal',
      entered_at: '2026-03-15T00:00:00.000Z',
      updated_at: '2026-03-15T00:00:00.000Z',
      closed_at: null,
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = Object.assign(
        (table: string) => {
          if (table === 'users') {
            return makeUserQuery();
          }

          if (table === 'tickets as t') {
            return ticketBuilder;
          }

          if (table === 'comments') {
            return {
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            };
          }

          if (table === 'documents as d') {
            return {
              select: vi.fn().mockReturnThis(),
              join: vi.fn().mockReturnThis(),
              where: vi.fn().mockResolvedValue([]),
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        },
        {
          raw: vi.fn().mockResolvedValue({ rows: [] }),
        }
      );

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-1'],
    });

    const { getClientTicketDetails } = await import('./client-tickets');
    const ticket = await getClientTicketDetails('ticket-1');

    expect(ticket.ticket_id).toBe('ticket-1');
    expect(applyVisibilityBoardFilterMock).toHaveBeenCalledWith(
      expect.any(Object),
      ['board-1']
    );
  });

  it('T011: client portal ticket detail rejects direct access to a hidden-board ticket', async () => {
    const ticketBuilder = makeDetailBuilder(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = Object.assign(
        (table: string) => {
          if (table === 'users') {
            return makeUserQuery();
          }

          if (table === 'tickets as t') {
            return ticketBuilder;
          }

          if (table === 'comments') {
            return {
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            };
          }

          if (table === 'documents as d') {
            return {
              select: vi.fn().mockReturnThis(),
              join: vi.fn().mockReturnThis(),
              where: vi.fn().mockResolvedValue([]),
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        },
        {
          raw: vi.fn().mockResolvedValue({ rows: [] }),
        }
      );

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-visible'],
    });

    const { getClientTicketDetails } = await import('./client-tickets');

    await expect(getClientTicketDetails('ticket-hidden')).rejects.toThrow(
      'Failed to fetch ticket details'
    );
  });

  it('T012: client portal ticket documents reject hidden-board access', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'users') {
          return makeUserQuery();
        }

        if (table === 'tickets') {
          return {
            where: vi.fn().mockReturnThis(),
            modify: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(undefined),
          };
        }

        if (table === 'documents as d') {
          return {
            select: vi.fn().mockReturnThis(),
            join: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([]),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-visible'],
    });

    const { getClientTicketDocuments } = await import('./client-tickets');

    await expect(getClientTicketDocuments('ticket-hidden')).rejects.toThrow(
      'Failed to fetch ticket documents'
    );
  });

  it('T015: client portal ticket creation rejects manually submitted disallowed boards', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'users') {
          return makeUserQuery();
        }

        if (table === 'statuses') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({ status_id: 'status-1' }),
            }),
          };
        }

        if (table === 'boards') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({ board_id: 'board-allowed' }),
            }),
          };
        }

        if (table === 'tickets') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({
                ticket_id: 'ticket-new',
                board_id: 'board-allowed',
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-allowed'],
    });

    const formData = new FormData();
    formData.append('title', 'Restricted ticket');
    formData.append('description', 'Should fail');
    formData.append('priority_id', 'priority-1');
    formData.append('board_id', 'board-hidden');

    const { createClientTicket } = await import('./client-tickets');

    await expect(createClientTicket(formData)).rejects.toThrow(
      'Visibility group assignment is invalid for this contact.'
    );
    expect(createTicketWithRetryMock).not.toHaveBeenCalled();
  });

  it('T008: client portal ticket creation rejects inactive boards even when they appear in visibility memberships', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'users') {
          return makeUserQuery();
        }

        if (table === 'boards') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(undefined),
            }),
          };
        }

        if (table === 'statuses') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({ status_id: 'status-1' }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-inactive'],
    });

    const formData = new FormData();
    formData.append('title', 'Inactive board ticket');
    formData.append('description', 'Should fail');
    formData.append('priority_id', 'priority-1');
    formData.append('board_id', 'board-inactive');

    const { createClientTicket } = await import('./client-tickets');

    await expect(createClientTicket(formData)).rejects.toThrow(
      'Visibility group assignment is invalid for this contact.'
    );
    expect(createTicketWithRetryMock).not.toHaveBeenCalled();
  });

  it('T016: unassigned contacts can still create tickets with unrestricted behavior', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'users') {
          return makeUserQuery();
        }

        if (table === 'boards') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({ board_id: 'board-open' }),
            }),
          };
        }

        if (table === 'statuses') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({ status_id: 'status-1' }),
            }),
          };
        }

        if (table === 'tickets') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({
                ticket_id: 'ticket-new',
                board_id: 'board-open',
                title: 'Created ticket',
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: null,
      visibleBoardIds: null,
    });
    createTicketWithRetryMock.mockResolvedValue({ ticket_id: 'ticket-new' });

    const formData = new FormData();
    formData.append('title', 'Open access ticket');
    formData.append('description', 'Allowed');
    formData.append('priority_id', 'priority-1');
    formData.append('board_id', 'board-open');

    const { createClientTicket } = await import('./client-tickets');
    const ticket = await createClientTicket(formData);

    expect(createTicketWithRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: 'board-open',
        client_id: 'client-1',
        contact_id: 'contact-1',
      }),
      'tenant-1',
      expect.anything(),
      {},
      expect.anything(),
      expect.anything(),
      'client-user-1',
      3
    );
    expect(ticket.ticket_id).toBe('ticket-new');
  });
});
