import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let boardRow: Record<string, unknown>;
const boardUpdates: Array<Record<string, unknown>> = [];

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const saveBoardTicketStatusesForBoardMock = vi.fn();
const publishEventMock = vi.fn();

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
    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

describe('updateBoard portal status-configuration guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boardUpdates.length = 0;
    currentUser = { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' };
    boardRow = {
      board_id: 'board-a',
      board_name: 'Board A',
      enable_live_ticket_timer: true,
    };
    createTenantKnexMock.mockResolvedValue({ knex: { any: true } });
    withTransactionMock.mockImplementation(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback(createTrx())
    );
    saveBoardTicketStatusesForBoardMock.mockResolvedValue([]);
    publishEventMock.mockResolvedValue(undefined);
  });

  it('T031: a portal caller cannot write ticket statuses through updateBoard and no mutation occurs first', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { updateBoard } = await import('./boardActions');

    const result = await updateBoard('board-a', {
      board_name: 'Board A',
      is_default: true,
      ticket_statuses: [{ name: 'Open', is_closed: false, is_default: true }],
    } as any);

    expect(result).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });
    expect(saveBoardTicketStatusesForBoardMock).not.toHaveBeenCalled();
    // The unset-other-defaults mutation and the board update both happen after
    // the authorization gate, so neither ran.
    expect(boardUpdates).toHaveLength(0);
  });

  it('T032: an authorized administrator can save ticket statuses through updateBoard', async () => {
    hasPermissionMock.mockResolvedValue(true);

    const { updateBoard } = await import('./boardActions');
    const ticketStatuses = [
      { name: 'Open', is_closed: false, is_default: true, portal_selectable: false },
    ];

    const result = await updateBoard('board-a', {
      board_name: 'Board A',
      ticket_statuses: ticketStatuses,
    } as any);

    expect(isReturnedActionError(result)).toBe(false);
    expect(boardUpdates).toHaveLength(1);
    expect(saveBoardTicketStatusesForBoardMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'board-a',
      'user-1',
      ticketStatuses
    );
  });

  it('T033: updateBoard without ticket_statuses does not require ticket_settings:update', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { updateBoard } = await import('./boardActions');

    const result = await updateBoard('board-a', { board_name: 'Renamed' } as any);

    expect(isReturnedActionError(result)).toBe(false);
    expect(saveBoardTicketStatusesForBoardMock).not.toHaveBeenCalled();
    expect(boardUpdates).toHaveLength(1);
  });
});
