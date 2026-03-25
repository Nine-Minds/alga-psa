// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const revalidatePathMock = vi.fn();
const updateTicketWithCacheMock = vi.fn();

const getDefaultStatusIdMock = vi.fn();
const validateStatusBelongsToBoardMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action({ user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(),
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

vi.mock('./optimizedTicketActions', () => ({
  updateTicketWithCache: (...args: any[]) => updateTicketWithCacheMock(...args),
}));

vi.mock('../models/ticket', () => ({
  default: {},
}));

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: vi.fn(),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

vi.mock('@alga-psa/validation', () => ({
  validateData: vi.fn((_schema: unknown, data: unknown) => data),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({
    publish: vi.fn(),
  })),
}));

vi.mock('@alga-psa/event-bus/events', () => ({
  TicketCreatedEvent: class {},
  TicketUpdatedEvent: class {},
  TicketClosedEvent: class {},
  TicketResponseStateChangedEvent: class {},
}));

vi.mock('../lib/adapters/TicketModelEventPublisher', () => ({
  TicketModelEventPublisher: class {},
}));

vi.mock('../lib/adapters/TicketModelAnalyticsTracker', () => ({
  TicketModelAnalyticsTracker: class {},
}));

vi.mock('../lib/workflowTicketTransitionEvents', () => ({
  buildTicketTransitionWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/workflowTicketCommunicationEvents', () => ({
  buildTicketCommunicationWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/ticketOrigin', () => ({
  getTicketOrigin: vi.fn(),
}));

vi.mock('../lib/workflowTicketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(),
  buildTicketResolutionSlaStageEnteredEvent: vi.fn(),
}));

vi.mock('@alga-psa/sla/services', () => ({
  SlaBackendFactory: {},
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
    getDefaultStatusIdMock.mockReset();
    validateStatusBelongsToBoardMock.mockReset();
    updateTicketWithCacheMock.mockReset();
    updateTicketWithCacheMock.mockResolvedValue('success');
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
    expect(updateTicketWithCacheMock).toHaveBeenCalledWith('ticket-1', expect.objectContaining({
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
        board_id: 'board-dest',
        category_id: 'cat-keep',
        subcategory_id: 'subcat-keep',
      }]
    ]);
    validateStatusBelongsToBoardMock.mockResolvedValue({ valid: true });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-2'], 'board-dest', 'status-override');

    expect(getDefaultStatusIdMock).not.toHaveBeenCalled();
    expect(validateStatusBelongsToBoardMock).toHaveBeenCalledWith('status-override', 'board-dest', 'tenant-1', expect.anything());
    expect(result).toEqual({ movedIds: ['ticket-2'], failed: [] });
    expect(updateTicketWithCacheMock).toHaveBeenCalledWith('ticket-2', {
      board_id: 'board-dest',
      status_id: 'status-override',
    });
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
    updateTicketWithCacheMock
      .mockResolvedValueOnce('success')
      .mockRejectedValueOnce(new Error('This ticket is bundled; workflow fields are locked (status_id). Update the master ticket instead.'));
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-5', 'ticket-6'], 'board-dest', '');

    expect(result.movedIds).toEqual(['ticket-5']);
    expect(result.failed).toEqual([
      {
        ticketId: 'ticket-6',
        message: 'This ticket is bundled; workflow fields are locked (status_id). Update the master ticket instead.',
      },
    ]);
  });

  it('T014: permission failures are returned per-ticket and do not move ticket rows', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-7', { ticket_id: 'ticket-7', tenant: 'tenant-1', board_id: 'board-source' }],
      ['ticket-8', { ticket_id: 'ticket-8', tenant: 'tenant-1', board_id: 'board-source' }],
    ]);
    validateStatusBelongsToBoardMock.mockResolvedValue({ valid: true });
    updateTicketWithCacheMock
      .mockResolvedValueOnce('success')
      .mockRejectedValueOnce(new Error('Permission denied: Cannot update ticket'));
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-7', 'ticket-8'], 'board-dest', 'status-selected');

    expect(validateStatusBelongsToBoardMock).toHaveBeenCalledWith('status-selected', 'board-dest', 'tenant-1', expect.anything());
    expect(result.failed).toEqual([
      { ticketId: 'ticket-8', message: 'Permission denied: Cannot update ticket' },
    ]);
    expect(result.movedIds).toEqual(['ticket-7']);
  });
});
