/**
 * createBoard / updateBoard / deleteBoard share boardMutationGuard: principal
 * check, then an unconditional ticket_settings:<action> check, then a strict
 * input projection — all before any read or write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
const granted = new Set<string>();
const writes: Array<{ table: string; op: string; payload?: unknown }> = [];
const reads: string[] = [];

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const publishEventMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: async (_user: any, resource: string, action: string) =>
    granted.has(`${resource}:${action}`),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({ table: (table: string) => conn(table) }),
}));

vi.mock('@alga-psa/core/config/deletion', () => ({
  countLiveCoManagedEscalationsForBoard: async () => 0,
  countCoManagedBoardScopes: async () => 0,
  countBoardChecklistApplyRules: async () => 0,
}));
vi.mock('../../models/board', () => ({ default: class Board {} }));
vi.mock('../../services/itilStandardsService', () => ({
  ItilStandardsService: class {
    static async handleItilConfiguration() {}
    static async cleanupUnusedItilStandards() {}
  },
}));
vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));
vi.mock('./boardTicketStatusActions', () => ({
  saveBoardTicketStatusesForBoard: vi.fn(async () => []),
}));
vi.mock('./boardViewSettingsSchema', () => ({
  parseTicketViewSettings: (value: unknown) => value,
}));
vi.mock('../../lib/ticketSlaSql', () => ({ ticketSlaBreachedBindings: {}, ticketSlaBreachedSql: {} }));

const boardRow = { board_id: 'board-a', board_name: 'A', is_default: false, is_inactive: false };

function createTrx() {
  return ((table: string) => {
    reads.push(table);
    const builder: any = {
      where: vi.fn(() => builder),
      whereNot: vi.fn(() => builder),
      whereNull: vi.fn(() => builder),
      select: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      orderByRaw: vi.fn(() => builder),
      max: vi.fn(() => builder),
      count: vi.fn(() => builder),
      first: vi.fn(async () => (table === 'boards' ? boardRow : undefined)),
      update: vi.fn((payload: unknown) => {
        writes.push({ table, op: 'update', payload });
        return { returning: vi.fn(async () => [boardRow]) };
      }),
      insert: vi.fn((payload: unknown) => {
        writes.push({ table, op: 'insert', payload });
        return { returning: vi.fn(async () => [{ ...boardRow, board_id: 'new-board' }]) };
      }),
      del: vi.fn(async () => {
        writes.push({ table, op: 'delete' });
        return 1;
      }),
    };
    return builder;
  }) as any;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
/** Which check refused, as logged server-side (the caller only ever sees the generic denial). */
const refusedBy = () =>
  warnSpy.mock.calls
    .filter((c: any[]) => c[0] === '[boards] mutation refused')
    .map((c: any[]) => (c[1] as { code: string }).code);
const PRINCIPAL = 'BOARD_PRINCIPAL_NOT_ALLOWED';
const PERMISSION = 'BOARD_PERMISSION_MISSING';

const denied = { permissionError: expect.stringContaining('Permission denied') };

describe('board mutation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    granted.clear();
    writes.length = 0;
    reads.length = 0;
    currentUser = { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' };
    createTenantKnexMock.mockResolvedValue({ knex: { any: true } });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (trx: unknown) => Promise<unknown>) =>
      cb(createTrx())
    );
    publishEventMock.mockResolvedValue(undefined);
  });

  describe('createBoard', () => {
    it('denies without ticket_settings:create and touches nothing (existing default stays default)', async () => {
      granted.add('ticket_settings:update');
      granted.add('ticket:create');
      const { createBoard } = await import('./boardActions');
      const result = await createBoard({ board_name: 'X', is_default: true } as any);
      expect(result).toMatchObject(denied);
      expect(refusedBy()).toEqual([PERMISSION]);
      expect(withTransactionMock).not.toHaveBeenCalled();
      expect(reads).toHaveLength(0);
      expect(writes).toHaveLength(0);
    });

    it('denies a client-portal principal even when permissions are granted', async () => {
      currentUser.user_type = 'client';
      granted.add('ticket_settings:create');
      const { createBoard } = await import('./boardActions');
      const result = await createBoard({ board_name: 'X' } as any);
      expect(result).toMatchObject(denied);
      expect(refusedBy()).toEqual([PRINCIPAL]);
      expect(writes).toHaveLength(0);
    });

    it('does not leak which check refused: portal and missing-permission callers see identical text', async () => {
      const { createBoard } = await import('./boardActions');
      const missing = await createBoard({ board_name: 'X' } as any);
      currentUser.user_type = 'client';
      granted.add('ticket_settings:create');
      const portal = await createBoard({ board_name: 'X' } as any);
      expect(portal).toEqual(missing);
      expect(refusedBy()).toEqual([PERMISSION, PRINCIPAL]);
    });

    it('allows a permitted MSP user', async () => {
      granted.add('ticket_settings:create');
      const { createBoard } = await import('./boardActions');
      const result = await createBoard({
        board_name: 'X',
        is_pinned: false,
        ticket_statuses: [{ name: 'Open', is_closed: false, is_default: true }],
      } as any);
      expect(result).not.toHaveProperty('permissionError');
      expect(result).not.toHaveProperty('actionError');
      expect(writes.some((w) => w.table === 'boards' && w.op === 'insert')).toBe(true);
    });

    it.each([
      ['tenant', { tenant: 'other' }],
      ['board_id', { board_id: 'abc' }],
      ['made-up column', { not_a_column: 1 }],
      ['dead display_* column', { display_priority: true }],
      ['wrongly typed value', { is_default: 'yes' }],
      ['wrongly typed name', { board_name: 42 }],
    ])('rejects %s before any write', async (_label, extra) => {
      granted.add('ticket_settings:create');
      const { createBoard } = await import('./boardActions');
      const result = await createBoard({ board_name: 'X', ...extra } as any);
      expect(result).toMatchObject({ actionError: expect.stringContaining('Invalid board input') });
      expect(withTransactionMock).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });
  });

  describe('updateBoard', () => {
    it('denies a payload WITHOUT is_pinned/list_view_settings/ticket_statuses (finding 2 bypass), leaving defaults untouched', async () => {
      const { updateBoard } = await import('./boardActions');
      const result = await updateBoard('board-a', { is_default: true, board_name: 'Hijack' } as any);
      expect(result).toMatchObject(denied);
      expect(refusedBy()).toEqual([PERMISSION]);
      expect(withTransactionMock).not.toHaveBeenCalled();
      expect(reads).toHaveLength(0);
      expect(writes).toHaveLength(0);
    });

    it('denies a client-portal principal', async () => {
      currentUser.user_type = 'client';
      granted.add('ticket_settings:update');
      const { updateBoard } = await import('./boardActions');
      const result = await updateBoard('board-a', { board_name: 'Y' } as any);
      expect(result).toMatchObject(denied);
      expect(refusedBy()).toEqual([PRINCIPAL]);
      expect(writes).toHaveLength(0);
    });

    it('allows a permitted MSP user and writes only the projection', async () => {
      granted.add('ticket_settings:update');
      const { updateBoard } = await import('./boardActions');
      const result = await updateBoard('board-a', { board_name: 'Y', description: undefined } as any);
      expect(result).not.toHaveProperty('permissionError');
      const update = writes.find((w) => w.table === 'boards' && w.op === 'update');
      expect(update?.payload).toEqual({ board_name: 'Y' });
    });

    it.each([
      ['tenant', { tenant: 'other' }],
      ['board_id', { board_id: 'other-board' }],
      ['made-up column', { not_a_column: 1 }],
      ['wrongly typed value', { is_inactive: 'false' }],
      ['malformed status', { ticket_statuses: [{ name: 'Open' }] }],
    ])('rejects %s before any read or write', async (_label, extra) => {
      granted.add('ticket_settings:update');
      const { updateBoard } = await import('./boardActions');
      const result = await updateBoard('board-a', { board_name: 'Y', ...extra } as any);
      expect(result).toMatchObject({ actionError: expect.stringContaining('Invalid board input') });
      expect(withTransactionMock).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });
  });

  describe('deleteBoard', () => {
    it('denies ticket:delete without ticket_settings:delete', async () => {
      granted.add('ticket:delete');
      const { deleteBoard } = await import('./boardActions');
      const result = await deleteBoard('board-a');
      expect(result).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
      expect(refusedBy()).toEqual([PERMISSION]);
      expect(withTransactionMock).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });

    it('denies a client-portal principal', async () => {
      currentUser.user_type = 'client';
      granted.add('ticket_settings:delete');
      const { deleteBoard } = await import('./boardActions');
      const result = await deleteBoard('board-a');
      expect(result).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
      expect(refusedBy()).toEqual([PRINCIPAL]);
      expect(withTransactionMock).not.toHaveBeenCalled();
    });

    it('lets a ticket_settings:delete MSP user past the guard (no ticket:delete needed)', async () => {
      granted.add('ticket_settings:delete');
      const { deleteBoard } = await import('./boardActions');
      const result = await deleteBoard('board-a').catch((e: Error) => e);
      expect(result).not.toMatchObject({ code: 'PERMISSION_DENIED' });
      expect(refusedBy()).toEqual([]);
      expect(withTransactionMock).toHaveBeenCalled();
    });
  });
});
