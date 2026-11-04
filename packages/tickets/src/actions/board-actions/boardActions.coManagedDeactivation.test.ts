/**
 * Deactivating a board hides it from every co-management read just as deleting
 * it would: an MSP escalation queue stopped receiving escalations (and left a
 * pending customer's review unable to load), and a customer's shared board
 * dropped out of the MSP's oversight.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let boardRow: Record<string, unknown>;
const boardUpdates: Array<Record<string, unknown>> = [];

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const saveBoardTicketStatusesForBoardMock = vi.fn();
const publishEventMock = vi.fn();
const escalationCount = vi.fn();
const sharedScopeCount = vi.fn();

type ReturnedActionError = { actionError: string } | { permissionError: string };

function isReturnedActionError(value: unknown): value is ReturnedActionError {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ('actionError' in value || 'permissionError' in value)
  );
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
  }),
}));

vi.mock('@alga-psa/core/config/deletion', () => ({
  countLiveCoManagedEscalationsForBoard: (...args: any[]) => escalationCount(...args),
  countCoManagedBoardScopes: (...args: any[]) => sharedScopeCount(...args),
  countBoardChecklistApplyRules: async () => 0,
}));

vi.mock('../../models/board', () => ({ default: class Board {} }));

vi.mock('../../services/itilStandardsService', () => ({
  ItilStandardsService: class {
    static async handleItilConfiguration() {}
    static async cleanupUnusedItilStandards() {}
  },
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('./boardTicketStatusActions', () => ({
  saveBoardTicketStatusesForBoard: (...args: any[]) => saveBoardTicketStatusesForBoardMock(...args),
}));

vi.mock('./boardViewSettingsSchema', () => ({
  parseTicketViewSettings: (value: unknown) => value,
}));

vi.mock('../../lib/ticketSlaSql', () => ({
  ticketSlaBreachedBindings: {},
  ticketSlaBreachedSql: {},
}));

function createTrx() {
  return ((table: string) => {
    if (table === 'boards') {
      const builder: any = {
        where: vi.fn(() => builder),
        whereNot: vi.fn(() => builder),
        first: vi.fn(async () => boardRow),
        update: vi.fn((payload: Record<string, unknown>) => {
          boardUpdates.push(payload);
          return { returning: vi.fn(async () => [boardRow]) };
        }),
        returning: vi.fn(async () => [boardRow]),
      };
      return builder;
    }
    if (table === 'inbound_ticket_defaults') {
      const builder: any = { where: vi.fn(() => builder), count: vi.fn(() => builder), first: vi.fn(async () => ({ count: 0 })) };
      return builder;
    }
    // Other board-delete blockers (email routes, templates, ...) find nothing.
    const empty: any = {
      where: vi.fn(() => empty), whereIn: vi.fn(() => empty), whereNull: vi.fn(() => empty), whereNot: vi.fn(() => empty),
      select: vi.fn(() => empty), count: vi.fn(() => empty), first: vi.fn(async () => ({ count: 0 })),
      then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    };
    return empty;
  }) as any;
}

describe('updateBoard co-managed deactivation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boardUpdates.length = 0;
    currentUser = { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' };
    boardRow = { board_id: 'board-a', board_name: 'Escalations', is_inactive: false };
    createTenantKnexMock.mockResolvedValue({ knex: { any: true } });
    withTransactionMock.mockImplementation(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback(createTrx())
    );
    hasPermissionMock.mockResolvedValue(true);
    escalationCount.mockResolvedValue(0);
    sharedScopeCount.mockResolvedValue(0);
  });

  it('refuses to deactivate an MSP escalation queue a live co-managed workspace uses', async () => {
    escalationCount.mockResolvedValue(1);
    const { updateBoard } = await import('./boardActions');
    const result = await updateBoard('board-a', { is_inactive: true } as any);
    expect(result).toMatchObject({ actionError: expect.stringContaining('receives escalated tickets from a co-managed IT workspace') });
    expect(boardUpdates).toHaveLength(0);
  });

  it('refuses to deactivate a board shared with the MSP', async () => {
    sharedScopeCount.mockResolvedValue(1);
    const { updateBoard } = await import('./boardActions');
    const result = await updateBoard('board-a', { is_inactive: true } as any);
    expect(result).toMatchObject({ actionError: expect.stringContaining('shared with your MSP') });
    expect(boardUpdates).toHaveLength(0);
  });

  it('deactivates a board no co-management depends on, and ignores the check for other edits', async () => {
    const { updateBoard } = await import('./boardActions');
    expect(isReturnedActionError(await updateBoard('board-a', { is_inactive: true } as any))).toBe(false);
    escalationCount.mockResolvedValue(1);
    expect(isReturnedActionError(await updateBoard('board-a', { board_name: 'Renamed' } as any))).toBe(false);
    expect(boardUpdates).toHaveLength(2);
  });

  it('refuses to delete a board co-management depends on, even when forced', async () => {
    const { deleteBoard } = await import('./boardActions');
    escalationCount.mockResolvedValue(1);
    await expect(deleteBoard('board-a', true, true)).resolves.toMatchObject({ success: false, code: 'BOARD_IN_CO_MANAGEMENT' });
    escalationCount.mockResolvedValue(0);
    sharedScopeCount.mockResolvedValue(2);
    await expect(deleteBoard('board-a', true, true)).resolves.toMatchObject({ success: false, code: 'BOARD_IN_CO_MANAGEMENT',
      counts: { co_managed_relationship: 2 } });
  });
});
