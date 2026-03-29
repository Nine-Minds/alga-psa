import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const hasPermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
const publishEventMock = vi.fn();
const ticketModelGetDefaultStatusIdMock = vi.fn();
const ticketModelCreateTicketWithRetryMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/validation', () => ({
  validateData: (_schema: unknown, payload: Record<string, unknown>) => payload,
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: {
    getDefaultStatusId: (...args: any[]) => ticketModelGetDefaultStatusIdMock(...args),
    createTicketWithRetry: (...args: any[]) => ticketModelCreateTicketWithRetryMock(...args),
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

vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
}));

function createClientPortalTrx(overrides: {
  defaultBoard?: Record<string, unknown> | null;
  ticket?: Record<string, unknown> | null;
  statusForBoard?: Record<string, unknown> | null;
}) {
  const ticketUpdates: Array<Record<string, unknown>> = [];

  const trx = Object.assign(
    (table: string) => {
      if (table === 'users') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ user_id: currentUser.user_id, contact_id: 'contact-1' }),
          }),
        };
      }

      if (table === 'contacts') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ contact_name_id: 'contact-1', client_id: 'client-1' }),
          }),
        };
      }

      if (table === 'boards') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(overrides.defaultBoard ?? null),
          }),
        };
      }

      if (table === 'tickets') {
        let whereClause: Record<string, unknown> = {};
        return {
          where: vi.fn((value: Record<string, unknown>) => {
            whereClause = value;
            return {
              first: vi.fn().mockResolvedValue(overrides.ticket ?? null),
              update: vi.fn(async (updateData: Record<string, unknown>) => {
                ticketUpdates.push({ where: whereClause, updateData });
                return 1;
              }),
            };
          }),
        };
      }

      if (table === 'statuses') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(overrides.statusForBoard ?? null),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
    {
      fn: { now: () => 'now()' },
      raw: vi.fn().mockResolvedValue({ rows: [] }),
    }
  ) as any;

  return { trx, ticketUpdates };
}

describe('client portal board-scoped ticket status validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      email: 'client@example.com',
      tenant: 'tenant-1',
    };

    const dbConnection = Object.assign(vi.fn(), {
      raw: vi.fn(),
    });
    getConnectionMock.mockResolvedValue(dbConnection);
    hasPermissionMock.mockResolvedValue(true);
    ticketModelGetDefaultStatusIdMock.mockResolvedValue('board-1-default-status');
    ticketModelCreateTicketWithRetryMock.mockResolvedValue({ ticket_id: 'ticket-1' });
    publishEventMock.mockResolvedValue(undefined);
  });

  it('T041: createClientTicket resolves the default status from the default board before ticket creation', async () => {
    const { trx } = createClientPortalTrx({
      defaultBoard: { board_id: 'board-1', default_assigned_to: null },
      ticket: { ticket_id: 'ticket-1', tenant: 'tenant-1' },
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { createClientTicket } = await import('./client-tickets');
    const formData = new FormData();
    formData.append('title', 'Portal issue');
    formData.append('description', 'Customer reported an outage');
    formData.append('priority_id', 'priority-1');

    await createClientTicket(formData);

    expect(ticketModelGetDefaultStatusIdMock).toHaveBeenCalledWith('tenant-1', trx, 'board-1');
    expect(ticketModelCreateTicketWithRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: 'board-1',
        status_id: 'board-1-default-status',
      }),
      'tenant-1',
      trx,
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      'client-user-1',
      3
    );
  });

  it('T042: updateTicketStatus rejects a status that does not belong to the ticket board', async () => {
    const { trx, ticketUpdates } = createClientPortalTrx({
      ticket: {
        ticket_id: 'ticket-1',
        tenant: 'tenant-1',
        board_id: 'board-1',
        status_id: 'board-1-open',
      },
      statusForBoard: null,
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { updateTicketStatus } = await import('./client-tickets');

    await expect(updateTicketStatus('ticket-1', 'board-2-closed')).rejects.toThrow('Failed to update ticket status');
    expect(ticketUpdates).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
  });
});
