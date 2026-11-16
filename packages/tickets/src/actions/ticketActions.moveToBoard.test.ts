// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const revalidatePathMock = vi.fn();
const updateTicketWithCacheMock = vi.fn();
const updateTicketInTransactionMock = vi.fn();
const hasPermissionMock = vi.fn();
const createTagsForEntityWithTransactionMock = vi.fn();
const findTagsByEntityIdsMock = vi.fn();
const bulkApplyTagsToEntitiesMock = vi.fn();
const getTagsByEntitiesMock = vi.fn();
const authorizeTicketRecordAccessMock = vi.fn();
const authorizeTicketRecordAccessConcealedMock = vi.fn();
const assignTeamToTicketMock = vi.fn();
const removeTeamFromTicketMock = vi.fn();

const securityState = vi.hoisted(() => ({
  user: { user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1' } as any,
  createdTags: [] as Array<{ entityId: string; tagText: string }>,
  appointmentRows: [] as Array<Record<string, unknown>>,
  appointmentQueryCount: 0,
  authorizationOrder: [] as string[],
  deniedTicketId: null as string | null,
}));

const getDefaultStatusIdMock = vi.fn();
const validateStatusBelongsToBoardMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(securityState.user, { tenant: 'tenant-1' }, ...args),
  // The real one resolves the caller's locale; with no request scope here it
  // would return the payload unchanged anyway.
  localizeActionError: async (result: unknown) => result,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any) => query,
  }),
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
  updateTicketInTransaction: (...args: any[]) => updateTicketInTransactionMock(...args),
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

vi.mock('@alga-psa/tags/actions', () => ({
  createTagsForEntityWithTransaction: (...args: any[]) => createTagsForEntityWithTransactionMock(...args),
  findTagsByEntityIds: (...args: any[]) => findTagsByEntityIdsMock(...args),
}));

// ticketActions imports the deep modules, not the barrel — mock those too so
// the real tagActions (which needs withOptionalAuth at module load) never loads.
vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntityWithTransaction: (...args: any[]) => createTagsForEntityWithTransactionMock(...args),
  findTagsByEntityIds: (...args: any[]) => findTagsByEntityIdsMock(...args),
  bulkApplyTagsToEntities: (...args: any[]) => bulkApplyTagsToEntitiesMock(...args),
}));

vi.mock('@alga-psa/tags/models/tagMapping', () => ({
  default: {
    getByEntities: (...args: any[]) => getTagsByEntitiesMock(...args),
  },
}));

vi.mock('../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: (...args: any[]) => authorizeTicketRecordAccessMock(...args),
  authorizeTicketRecordAccessConcealed: (...args: any[]) => authorizeTicketRecordAccessConcealedMock(...args),
}));

vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({
  isTagActionError: () => false,
}));

vi.mock('./teamAssignmentActions', () => ({
  assignTeamToTicket: (...args: any[]) => assignTeamToTicketMock(...args),
  removeTeamFromTicket: (...args: any[]) => removeTeamFromTicketMock(...args),
}));

vi.mock('@alga-psa/validation', () => ({
  validateData: vi.fn((_schema: unknown, data: unknown) => data),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
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

vi.mock('@alga-psa/shared/services/tickets/ticketModelEventPublisher', () => ({
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

vi.mock('@alga-psa/shared/services/tickets/ticketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(),
  buildTicketResolutionSlaStageEnteredEvent: vi.fn(),
}));

vi.mock('@alga-psa/sla/services', () => ({
  SlaBackendFactory: {},
}));

function createMockTrx(
  tickets: Map<string, Record<string, any>>,
  boards: Map<string, Record<string, any>> = new Map([['board-dest', { board_id: 'board-dest', is_inactive: false }]]),
) {
  return ((table: string) => {
    let whereClause: Record<string, any> | undefined;
    if (table === 'boards') {
      const boardsApi: any = {
        select: () => boardsApi,
        where: (criteria: Record<string, any>) => {
          whereClause = criteria;
          return boardsApi;
        },
        first: async () => (whereClause?.board_id ? boards.get(whereClause.board_id) : undefined),
      };
      return boardsApi;
    }
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
    if (table === 'appointment_requests as ar') {
      const query: any = {
        where: () => query,
        select: () => query,
        orderBy: async () => {
          securityState.appointmentQueryCount += 1;
          return securityState.appointmentRows;
        },
      };
      return query;
    }
    if (table !== 'tickets') return { where: vi.fn().mockReturnThis(), first: vi.fn(), update: vi.fn() };
    return tableApi;
  }) as any;
}

describe('ticketActions moveTicketsToBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    securityState.user = { user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1' };
    securityState.createdTags = [];
    securityState.appointmentRows = [];
    securityState.appointmentQueryCount = 0;
    securityState.authorizationOrder = [];
    securityState.deniedTicketId = null;
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    getTagsByEntitiesMock.mockReset().mockResolvedValue([]);
    hasPermissionMock.mockResolvedValue(true);
    getDefaultStatusIdMock.mockReset();
    validateStatusBelongsToBoardMock.mockReset();
    updateTicketWithCacheMock.mockReset();
    updateTicketWithCacheMock.mockResolvedValue('success');
    updateTicketInTransactionMock.mockReset();
    updateTicketInTransactionMock.mockResolvedValue('success');
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    authorizeTicketRecordAccessMock.mockReset();
    authorizeTicketRecordAccessMock.mockImplementation(async (input: any) => {
      securityState.authorizationOrder.push(`authorize:${input.ticketId}`);
      if (input.ticketId === securityState.deniedTicketId) {
        throw new Error('Permission denied: Cannot access ticket');
      }
    });
    authorizeTicketRecordAccessConcealedMock.mockReset();
    authorizeTicketRecordAccessConcealedMock.mockImplementation(async () => undefined);
    bulkApplyTagsToEntitiesMock.mockReset();
    bulkApplyTagsToEntitiesMock.mockImplementation(async (_trx: any, _tenant: string, _type: string, applications: any[]) => {
      securityState.authorizationOrder.push('apply-tags');
      for (const application of applications) {
        for (const tagText of application.newTexts) {
          securityState.createdTags.push({ entityId: application.entityId, tagText });
        }
      }
      return { appliedByEntity: {} };
    });
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
    expect(updateTicketWithCacheMock).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({
        board_id: 'board-dest',
        status_id: 'status-default',
        category_id: null,
        subcategory_id: null,
      }),
      {},
    );
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
    expect(updateTicketWithCacheMock).toHaveBeenCalledWith(
      'ticket-2',
      {
        board_id: 'board-dest',
        status_id: 'status-override',
      },
      {},
    );
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

  it('rejects an inactive destination board for every selected ticket without moving any', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-11', { ticket_id: 'ticket-11', tenant: 'tenant-1', board_id: 'board-source' }],
      ['ticket-12', { ticket_id: 'ticket-12', tenant: 'tenant-1', board_id: 'board-source' }],
    ]);
    const boards = new Map([['board-dest', { board_id: 'board-dest', is_inactive: true }]]);
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(createMockTrx(tickets, boards)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-11', 'ticket-12'], 'board-dest', '');

    expect(result).toEqual({
      movedIds: [],
      failed: [
        { ticketId: 'ticket-11', message: 'The destination board is inactive. Choose an active board.' },
        { ticketId: 'ticket-12', message: 'The destination board is inactive. Choose an active board.' },
      ],
    });
    expect(getDefaultStatusIdMock).not.toHaveBeenCalled();
    expect(updateTicketWithCacheMock).not.toHaveBeenCalled();
  });

  it('rejects a destination board that does not exist', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-13', { ticket_id: 'ticket-13', tenant: 'tenant-1', board_id: 'board-source' }],
    ]);
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(createMockTrx(tickets, new Map())));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-13'], 'board-missing', 'status-1');

    expect(result).toEqual({
      movedIds: [],
      failed: [
        { ticketId: 'ticket-13', message: 'Board not found. It may have been deleted. Please refresh and try again.' },
      ],
    });
    expect(validateStatusBelongsToBoardMock).not.toHaveBeenCalled();
    expect(updateTicketWithCacheMock).not.toHaveBeenCalled();
  });

  it('T042: forwards suppression flags to every moved ticket', async () => {
    const tickets = new Map<string, Record<string, any>>([
      ['ticket-9', { ticket_id: 'ticket-9', tenant: 'tenant-1', board_id: 'board-source' }],
      ['ticket-10', { ticket_id: 'ticket-10', tenant: 'tenant-1', board_id: 'board-source' }],
    ]);
    const options = {
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    };
    validateStatusBelongsToBoardMock.mockResolvedValue({ valid: true });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(tickets)));

    const { moveTicketsToBoard } = await import('./ticketActions');
    const result = await moveTicketsToBoard(['ticket-9', 'ticket-10'], 'board-dest', 'status-selected', options);

    expect(result).toEqual({ movedIds: ['ticket-9', 'ticket-10'], failed: [] });
    expect(updateTicketWithCacheMock).toHaveBeenNthCalledWith(
      1,
      'ticket-9',
      expect.objectContaining({ board_id: 'board-dest', status_id: 'status-selected' }),
      options,
    );
    expect(updateTicketWithCacheMock).toHaveBeenNthCalledWith(
      2,
      'ticket-10',
      expect.objectContaining({ board_id: 'board-dest', status_id: 'status-selected' }),
      options,
    );
  });
});

describe('ticketActions bulk notification suppression options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    updateTicketInTransactionMock.mockResolvedValue('success');
    hasPermissionMock.mockResolvedValue(true);
    assignTeamToTicketMock.mockResolvedValue(undefined);
    removeTeamFromTicketMock.mockResolvedValue(undefined);
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback({}));
  });

  it('T029: bulk status update forwards silent options to each ticket update', async () => {
    const options = {
      suppressContactNotifications: true,
      suppressInternalNotifications: false,
    };

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    const result = await bulkUpdateTicketStatus(['ticket-1', 'ticket-2'], 'status-cleanup', options);

    expect(result).toEqual({ updatedIds: ['ticket-1', 'ticket-2'], failed: [] });
    expect(updateTicketInTransactionMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ user_id: 'internal-user-1' }),
      'tenant-1',
      'ticket-1',
      { status_id: 'status-cleanup' },
      options,
    );
    expect(updateTicketInTransactionMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ user_id: 'internal-user-1' }),
      'tenant-1',
      'ticket-2',
      { status_id: 'status-cleanup' },
      options,
    );
  });

  it('T032: non-silent bulk status update forwards default options for normal notifications', async () => {
    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    const result = await bulkUpdateTicketStatus(['ticket-normal-1', 'ticket-normal-2'], 'status-normal');

    expect(result).toEqual({ updatedIds: ['ticket-normal-1', 'ticket-normal-2'], failed: [] });
    expect(updateTicketInTransactionMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ user_id: 'internal-user-1' }),
      'tenant-1',
      'ticket-normal-1',
      { status_id: 'status-normal' },
      {},
    );
    expect(updateTicketInTransactionMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ user_id: 'internal-user-1' }),
      'tenant-1',
      'ticket-normal-2',
      { status_id: 'status-normal' },
      {},
    );
  });

  it('T038-T041: bulk priority, due-date, and user assignment forward suppression options', async () => {
    const options = {
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    };

    const {
      bulkAssignTickets,
      bulkUpdateTicketDueDate,
      bulkUpdateTicketPriority,
    } = await import('./ticketActions');

    await bulkUpdateTicketPriority(['ticket-priority'], 'priority-low', options);
    await bulkUpdateTicketDueDate(['ticket-due'], '2026-07-31T12:00:00.000Z', options);
    await bulkAssignTickets(['ticket-assignee'], { kind: 'user', userId: 'user-2' }, options);

    expect(updateTicketInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: 'internal-user-1' }),
      'tenant-1',
      'ticket-priority',
      { priority_id: 'priority-low' },
      options,
    );
    expect(updateTicketInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: 'internal-user-1' }),
      'tenant-1',
      'ticket-due',
      { due_date: '2026-07-31T12:00:00.000Z' },
      options,
    );
    expect(updateTicketInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: 'internal-user-1' }),
      'tenant-1',
      'ticket-assignee',
      { assigned_to: 'user-2' },
      options,
    );
  });

  it('T040: bulk team assignment forwards suppression options to the team assignment helper', async () => {
    const options = {
      suppressContactNotifications: true,
      suppressInternalNotifications: false,
    };

    const { bulkAssignTickets } = await import('./ticketActions');
    const result = await bulkAssignTickets(['ticket-team'], { kind: 'team', teamId: 'team-1' }, options);

    expect(result).toEqual({ updatedIds: ['ticket-team'], failed: [] });
    expect(assignTeamToTicketMock).toHaveBeenCalledWith('ticket-team', 'team-1', options);
    expect(removeTeamFromTicketMock).not.toHaveBeenCalled();
  });
});

describe('ticketActions bulk update permission handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    hasPermissionMock.mockResolvedValue(false);
  });

  it('returns per-ticket failures instead of throwing when bulk update permission is denied', async () => {
    const {
      bulkAddTagsToTickets,
      bulkAssignTickets,
      bulkUpdateTicketDueDate,
      bulkUpdateTicketPriority,
      bulkUpdateTicketStatus,
    } = await import('./ticketActions');

    const ticketIds = ['ticket-1', 'ticket-1', 'ticket-2'];
    const expectedFailures = [
      { ticketId: 'ticket-1', message: 'Permission denied: Cannot update tickets' },
      { ticketId: 'ticket-2', message: 'Permission denied: Cannot update tickets' },
    ];

    await expect(bulkAssignTickets(ticketIds, { kind: 'user', userId: 'user-1' })).resolves.toEqual({
      updatedIds: [],
      failed: expectedFailures,
    });
    await expect(bulkAddTagsToTickets(ticketIds, ['urgent'])).resolves.toEqual({
      updatedIds: [],
      failed: expectedFailures,
    });
    await expect(bulkUpdateTicketDueDate(ticketIds, '2026-07-08T12:00:00.000Z')).resolves.toEqual({
      updatedIds: [],
      failed: expectedFailures,
    });
    await expect(bulkUpdateTicketStatus(ticketIds, 'status-1')).resolves.toEqual({
      updatedIds: [],
      failed: expectedFailures,
    });
    await expect(bulkUpdateTicketPriority(ticketIds, 'priority-1')).resolves.toEqual({
      updatedIds: [],
      failed: expectedFailures,
    });

    expect(assignTeamToTicketMock).not.toHaveBeenCalled();
    expect(removeTeamFromTicketMock).not.toHaveBeenCalled();
    expect(createTagsForEntityWithTransactionMock).not.toHaveBeenCalled();
    expect(updateTicketInTransactionMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe('ticketActions ticket action authorization regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    securityState.user = { user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1' };
    securityState.createdTags = [];
    securityState.appointmentRows = [];
    securityState.appointmentQueryCount = 0;
    securityState.authorizationOrder = [];
    securityState.deniedTicketId = null;
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    getTagsByEntitiesMock.mockReset().mockResolvedValue([]);
    hasPermissionMock.mockReset().mockResolvedValue(true);
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(createMockTrx(new Map())));
    authorizeTicketRecordAccessMock.mockReset().mockImplementation(async (input: any) => {
      securityState.authorizationOrder.push(`authorize:${input.ticketId}`);
      if (input.ticketId === securityState.deniedTicketId) throw new Error('Permission denied: Cannot access ticket');
    });
    authorizeTicketRecordAccessConcealedMock.mockReset().mockImplementation(async (input: any) => {
      if (input.ticketId === securityState.deniedTicketId) throw new Error('Permission denied: Cannot access ticket');
    });
    bulkApplyTagsToEntitiesMock.mockReset().mockImplementation(async (_trx: any, _tenant: string, _type: string, applications: any[]) => {
      securityState.authorizationOrder.push('apply-tags');
      for (const application of applications) {
        for (const tagText of application.newTexts) securityState.createdTags.push({ entityId: application.entityId, tagText });
      }
      return { appliedByEntity: {} };
    });
  });

  it('denies a client with generic ticket:update before bulk tag creation or attachment', async () => {
    securityState.user = { user_id: 'client-user-1', user_type: 'client', clientId: 'client-1', tenant: 'tenant-1' };
    const { bulkAddTagsToTickets } = await import('./ticketActions');

    const result = await bulkAddTagsToTickets(['ticket-a'], ['new-tag']);

    expect(result).toEqual({
      updatedIds: [],
      failed: [{ ticketId: 'ticket-a', message: 'Permission denied: operation not available in client portal' }],
    });
    expect(hasPermissionMock).not.toHaveBeenCalled();
    expect(bulkApplyTagsToEntitiesMock).not.toHaveBeenCalled();
    expect(securityState.createdTags).toEqual([]);
  });

  it('denies an internal principal without tag:create', async () => {
    hasPermissionMock.mockImplementation(async (_user: any, resource: string, action: string) =>
      resource === 'ticket' && action === 'update');
    const { bulkAddTagsToTickets } = await import('./ticketActions');

    const result = await bulkAddTagsToTickets(['ticket-a'], ['new-tag']);

    expect(result).toEqual({
      updatedIds: [],
      failed: [{ ticketId: 'ticket-a', message: 'Permission denied: Cannot create tags' }],
    });
    expect(authorizeTicketRecordAccessMock).not.toHaveBeenCalled();
    expect(bulkApplyTagsToEntitiesMock).not.toHaveBeenCalled();
    expect(securityState.createdTags).toEqual([]);
  });

  it('rejects a mixed batch before creating or attaching any tags', async () => {
    securityState.deniedTicketId = 'ticket-hidden';
    const { bulkAddTagsToTickets } = await import('./ticketActions');

    const result = await bulkAddTagsToTickets(['ticket-visible', 'ticket-hidden'], ['new-tag']);

    expect(result.updatedIds).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(authorizeTicketRecordAccessMock).toHaveBeenCalledTimes(2);
    expect(securityState.authorizationOrder).toEqual(['authorize:ticket-visible', 'authorize:ticket-hidden']);
    expect(getTagsByEntitiesMock).not.toHaveBeenCalled();
    expect(bulkApplyTagsToEntitiesMock).not.toHaveBeenCalled();
    expect(securityState.createdTags).toEqual([]);
  });

  it('bulk tags all authorized tickets in one transaction after authorizing every target', async () => {
    const { bulkAddTagsToTickets } = await import('./ticketActions');

    const result = await bulkAddTagsToTickets(['ticket-a', 'ticket-b'], [' urgent ', 'urgent']);

    expect(result).toEqual({ updatedIds: ['ticket-a', 'ticket-b'], failed: [] });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(authorizeTicketRecordAccessMock).toHaveBeenCalledTimes(2);
    expect(authorizeTicketRecordAccessMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenant: 'tenant-1', ticketId: 'ticket-a', action: 'update',
    }));
    expect(authorizeTicketRecordAccessMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      tenant: 'tenant-1', ticketId: 'ticket-b', action: 'update',
    }));
    expect(bulkApplyTagsToEntitiesMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'ticket',
      [
        { entityId: 'ticket-a', newTexts: ['urgent'], existingTexts: [] },
        { entityId: 'ticket-b', newTexts: ['urgent'], existingTexts: [] },
      ],
    );
    expect(securityState.authorizationOrder).toEqual(['authorize:ticket-a', 'authorize:ticket-b', 'apply-tags']);
    expect(securityState.createdTags).toEqual([
      { entityId: 'ticket-a', tagText: 'urgent' },
      { entityId: 'ticket-b', tagText: 'urgent' },
    ]);
  });

  it('keeps existing tag snapshots and normalized targets in the authorized tenant transaction', async () => {
    const trx = createMockTrx(new Map());
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));
    getTagsByEntitiesMock.mockImplementation(async () => {
      securityState.authorizationOrder.push('read-tags');
      return [
        { tagged_id: 'ticket-a', tag_text: 'existing-a' },
        { tagged_id: 'ticket-b', tag_text: 'existing-b' },
      ];
    });
    const { bulkAddTagsToTickets } = await import('./ticketActions');

    const result = await bulkAddTagsToTickets(['ticket-a', 'ticket-a', 'ticket-b'], [' urgent ', 'urgent', '']);

    expect(result).toEqual({ updatedIds: ['ticket-a', 'ticket-b'], failed: [] });
    expect(securityState.authorizationOrder).toEqual([
      'authorize:ticket-a', 'authorize:ticket-b', 'read-tags', 'apply-tags',
    ]);
    for (const ticketId of ['ticket-a', 'ticket-b']) {
      expect(authorizeTicketRecordAccessMock).toHaveBeenCalledWith({
        trx, tenant: 'tenant-1', user: securityState.user, ticketId, action: 'update',
      });
    }
    expect(getTagsByEntitiesMock).toHaveBeenCalledExactlyOnceWith(trx, 'tenant-1', ['ticket-a', 'ticket-b'], 'ticket');
    expect(bulkApplyTagsToEntitiesMock).toHaveBeenCalledExactlyOnceWith(trx, 'tenant-1', 'ticket', [
      { entityId: 'ticket-a', newTexts: ['urgent'], existingTexts: ['existing-a'] },
      { entityId: 'ticket-b', newTexts: ['urgent'], existingTexts: ['existing-b'] },
    ]);
    expect(securityState.createdTags).toEqual([
      { entityId: 'ticket-a', tagText: 'urgent' },
      { entityId: 'ticket-b', tagText: 'urgent' },
    ]);
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock.mock.calls[0][0]).toBe('/msp/tickets');
  });

  it('reports every target as failed and leaves the list cache alone when tag storage rejects the batch', async () => {
    bulkApplyTagsToEntitiesMock.mockRejectedValue(new Error('tag storage failed'));
    const { bulkAddTagsToTickets } = await import('./ticketActions');

    const result = await bulkAddTagsToTickets(['ticket-a', 'ticket-a', 'ticket-b'], ['urgent']);

    expect(result.updatedIds).toEqual([]);
    expect(result.failed.map(({ ticketId }) => ticketId)).toEqual(['ticket-a', 'ticket-b']);
    expect(securityState.createdTags).toEqual([]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('conceals appointment access for a client with ticket:read on a hidden ticket', async () => {
    securityState.user = { user_id: 'client-user-1', user_type: 'client', clientId: 'client-1', tenant: 'tenant-1' };
    securityState.deniedTicketId = 'ticket-hidden';
    securityState.appointmentRows = [{ appointment_request_id: 'appointment-secret' }];
    const { getTicketAppointmentRequests } = await import('./ticketActions');

    const result = await getTicketAppointmentRequests('ticket-hidden');

    expect(result).toEqual({ success: false, error: 'Permission denied: Cannot access ticket' });
    expect(authorizeTicketRecordAccessConcealedMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-1',
      ticketId: 'ticket-hidden',
      action: 'read',
    }));
    expect(securityState.appointmentQueryCount).toBe(0);
    expect(result).not.toHaveProperty('data');
    expect(JSON.stringify(result)).not.toContain('appointment-secret');
  });

  it('returns appointment requests for an authorized ticket', async () => {
    securityState.appointmentRows = [{ appointment_request_id: 'appointment-1', service_name: 'Onsite visit' }];
    const { getTicketAppointmentRequests } = await import('./ticketActions');

    const result = await getTicketAppointmentRequests('ticket-visible');

    expect(result).toEqual({ success: true, data: securityState.appointmentRows });
    expect(authorizeTicketRecordAccessConcealedMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-1',
      ticketId: 'ticket-visible',
      action: 'read',
    }));
    expect(securityState.appointmentQueryCount).toBe(1);
  });
});
