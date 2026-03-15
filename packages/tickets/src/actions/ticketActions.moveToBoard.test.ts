import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const revalidatePathMock = vi.fn();

const getDefaultStatusIdMock = vi.fn();
const validateStatusBelongsToBoardMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action({ user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {
    getDefaultStatusId: (...args: any[]) => getDefaultStatusIdMock(...args),
    validateStatusBelongsToBoard: (...args: any[]) => validateStatusBelongsToBoardMock(...args),
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: any[]) => revalidatePathMock(...args),
}));

function createMockTrx(tickets: Map<string, Record<string, any>>) {
  return ((table: string) => {
    let whereClause: Record<string, any> | undefined;
    const tableApi: any = {
      where: (criteria: Record<string, any>) => {
        whereClause = criteria;
        return tableApi;
      },
      first: async () => {
        if (!whereClause?.ticket_id) {
          return undefined;
        }
        return tickets.get(whereClause.ticket_id);
      },
      update: async (updates: Record<string, any>) => {
        if (!whereClause?.ticket_id) {
          return 0;
        }
        const current = tickets.get(whereClause.ticket_id);
        if (!current) {
          return 0;
        }
        tickets.set(whereClause.ticket_id, { ...current, ...updates });
        return 1;
      },
    };
    if (table !== 'tickets') {
      return {
        where: vi.fn().mockReturnThis(),
        first: vi.fn(),
        update: vi.fn(),
      };
    }
    return tableApi;
  }) as any;
}

describe('ticketActions moveTicketsToBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    hasPermissionMock.mockResolvedValue(true);
    getDefaultStatusIdMock.mockReset();
    validateStatusBelongsToBoardMock.mockReset();
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const tickets = new Map();
      return callback(createMockTrx(tickets));
    });
  });

  it('T009: default destination status is used when no override is provided', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-1', {
        ticket_id: 'ticket-1',
        tenant: 'tenant-1',
        board_id: 'board-source',
        category_id: 'cat-1',
        subcategory_id: 'subcat-1',
      }]
    ]);
    getDefaultStatusIdMock.mockResolvedValue('status-default');
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-1'], 'board-dest', '');

    expect(getDefaultStatusIdMock).toHaveBeenCalledWith('tenant-1', expect.anything(), 'board-dest');
    expect(result).toEqual({ movedIds: ['ticket-1'], failed: [] });
    expect(tickets.get('ticket-1')).toEqual(expect.objectContaining({
      board_id: 'board-dest',
      status_id: 'status-default',
      category_id: null,
      subcategory_id: null,
    }));
  });

  it('T010: override status is used when destination status is provided', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-2', {
        ticket_id: 'ticket-2',
        tenant: 'tenant-1',
        board_id: 'board-source',
      }]
    ]);
    validateStatusBelongsToBoardMock.mockResolvedValue({ valid: true });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-2'], 'board-dest', 'status-override');

    expect(getDefaultStatusIdMock).not.toHaveBeenCalled();
    expect(validateStatusBelongsToBoardMock).toHaveBeenCalledWith('status-override', 'board-dest', 'tenant-1', expect.anything());
    expect(result).toEqual({ movedIds: ['ticket-2'], failed: [] });
    expect(tickets.get('ticket-2')?.status_id).toBe('status-override');
  });

  it('T012: invalid destination status fails for all selected tickets', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-3', { ticket_id: 'ticket-3', tenant: 'tenant-1', board_id: 'board-source' }],
      ['ticket-4', { ticket_id: 'ticket-4', tenant: 'tenant-1', board_id: 'board-source' }],
    ]);
    validateStatusBelongsToBoardMock.mockResolvedValue({ valid: false, error: 'Status not valid for this board' });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-3', 'ticket-4'], 'board-dest', 'invalid-status');

    expect(result).toEqual({
      movedIds: [],
      failed: [
        { ticketId: 'ticket-3', message: 'Status not valid for this board' },
        { ticketId: 'ticket-4', message: 'Status not valid for this board' },
      ],
    });
  });

  it('T013: returns partial success when one ticket moves and one fails', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-5', { ticket_id: 'ticket-5', tenant: 'tenant-1', board_id: 'board-source' }],
      ['ticket-6', { ticket_id: 'ticket-6', tenant: 'tenant-1', board_id: 'board-source' }],
    ]);
    getDefaultStatusIdMock.mockResolvedValue('status-default');
    hasPermissionMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-5', 'ticket-6'], 'board-dest', '');

    expect(result.movedIds).toEqual(['ticket-5']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].ticketId).toBe('ticket-6');
    expect(tickets.get('ticket-5')?.board_id).toBe('board-dest');
    expect(tickets.get('ticket-6')?.board_id).toBe('board-source');
  });

  it('T014: permission failures are returned per-ticket and do not move ticket rows', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-7', { ticket_id: 'ticket-7', tenant: 'tenant-1', board_id: 'board-source' }],
      ['ticket-8', { ticket_id: 'ticket-8', tenant: 'tenant-1', board_id: 'board-source' }],
    ]);
    getDefaultStatusIdMock.mockResolvedValue('status-default');
    hasPermissionMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-7', 'ticket-8'], 'board-dest', 'status-selected');

    expect(validateStatusBelongsToBoardMock).not.toHaveBeenCalled();
    expect(result.failed).toEqual([
      { ticketId: 'ticket-8', message: 'Permission denied: Cannot update ticket' },
    ]);
    expect(result.movedIds).toEqual(['ticket-7']);
    expect(tickets.get('ticket-7')?.board_id).toBe('board-dest');
    expect(tickets.get('ticket-8')?.board_id).toBe('board-source');
  });
});
