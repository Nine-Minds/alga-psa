import { beforeEach, describe, expect, it, vi } from 'vitest';

type BoardRow = {
  tenant: string;
  board_id: string;
};

type StatusRow = {
  tenant: string;
  status_id: string;
  board_id: string;
  name: string;
  status_type: 'ticket';
  is_closed: boolean;
  is_default: boolean;
  order_number: number;
  color?: string | null;
  icon?: string | null;
  created_by?: string;
};

let currentUser: any;
let state: { boards: BoardRow[]; statuses: StatusRow[] };

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('../../models/status', () => ({
  default: {
    getTicketStatusesByBoard: vi.fn(async (_trx: any, tenant: string, boardId: string) =>
      state.statuses
        .filter((status) => status.tenant === tenant && status.board_id === boardId && status.status_type === 'ticket')
        .sort((left, right) => left.order_number - right.order_number || left.name.localeCompare(right.name))
        .map((status) => ({ ...status }))
    ),
  },
}));

function matches(row: Record<string, unknown>, criteria: Record<string, unknown>) {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}

function createStatusQuery() {
  let filters: Array<Record<string, unknown>> = [];
  let includedIds: string[] | null = null;

  const applyFilters = () => state.statuses.filter((row) =>
    filters.every((criteria) => matches(row, criteria)) &&
    (includedIds ? includedIds.includes(row.status_id) : true)
  );

  return {
    columnInfo: async () => ({
      status_id: {},
      tenant: {},
      board_id: {},
      name: {},
      status_type: {},
      item_type: {},
      is_closed: {},
      is_default: {},
      order_number: {},
      is_custom: {},
      color: {},
      icon: {},
      created_at: {},
      updated_at: {},
    }),
    where(criteria: Record<string, unknown>) {
      filters.push(criteria);
      return this;
    },
    whereIn(_column: string, ids: string[]) {
      includedIds = ids;
      return this;
    },
    async update(payload: Record<string, unknown>) {
      const rows = applyFilters();
      state.statuses = state.statuses.map((status) =>
        rows.some((row) => row.status_id === status.status_id) ? { ...status, ...payload } as StatusRow : status
      );
      return rows.length;
    },
    async del() {
      const rows = applyFilters();
      state.statuses = state.statuses.filter((status) =>
        !rows.some((row) => row.status_id === status.status_id)
      );
      return rows.length;
    },
    async insert(rows: Record<string, unknown>[]) {
      state.statuses.push(...(rows as StatusRow[]));
      return rows;
    },
  };
}

function createBoardQuery() {
  let filters: Array<Record<string, unknown>> = [];

  const applyFilters = () => state.boards.filter((row) =>
    filters.every((criteria) => matches(row, criteria))
  );

  return {
    where(criteria: Record<string, unknown>) {
      filters.push(criteria);
      return this;
    },
    async first() {
      return applyFilters()[0];
    },
  };
}

function createTrx() {
  return ((table: string) => {
    if (table === 'boards') {
      return createBoardQuery();
    }

    if (table === 'statuses') {
      return createStatusQuery();
    }

    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

describe('boardTicketStatusActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { user_id: 'user-1', tenant: 'tenant-1' };
    state = {
      boards: [
        { tenant: 'tenant-1', board_id: 'board-a' },
        { tenant: 'tenant-1', board_id: 'board-b' },
      ],
      statuses: [
        {
          tenant: 'tenant-1',
          status_id: 'status-a-open',
          board_id: 'board-a',
          name: 'Open',
          status_type: 'ticket',
          is_closed: false,
          is_default: true,
          order_number: 10,
        },
        {
          tenant: 'tenant-1',
          status_id: 'status-a-closed',
          board_id: 'board-a',
          name: 'Closed',
          status_type: 'ticket',
          is_closed: true,
          is_default: false,
          order_number: 20,
        },
        {
          tenant: 'tenant-1',
          status_id: 'status-b-open',
          board_id: 'board-b',
          name: 'Open',
          status_type: 'ticket',
          is_closed: false,
          is_default: true,
          order_number: 10,
        },
      ],
    };
    createTenantKnexMock.mockResolvedValue({ knex: { any: true } });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(createTrx())
    );
  });

  it('T023: createBoardTicketStatus writes board ownership and only rejects duplicates on the same board', async () => {
    const { createBoardTicketStatus } = await import('./boardTicketStatusActions');

    const created = await createBoardTicketStatus('board-b', {
      name: 'Closed',
      is_closed: true,
      is_default: false,
    });

    expect(created.board_id).toBe('board-b');
    expect(state.statuses.some((status) => status.board_id === 'board-b' && status.name === 'Closed')).toBe(true);

    await expect(
      createBoardTicketStatus('board-b', {
        name: 'Open',
        is_closed: false,
        is_default: false,
      })
    ).rejects.toThrow('Ticket status names must be unique within a board.');
  });

  it('T024: updateBoardTicketStatus rejects implicit cross-board mutation', async () => {
    const { updateBoardTicketStatus } = await import('./boardTicketStatusActions');

    await expect(
      updateBoardTicketStatus('board-a', 'status-a-open', { board_id: 'board-b' } as any)
    ).rejects.toThrow('Ticket statuses cannot be moved across boards implicitly.');

    expect(state.statuses.find((status) => status.status_id === 'status-a-open')?.board_id).toBe('board-a');
  });

  it('T025: board-local default changes keep exactly one default on the edited board and leave other boards untouched', async () => {
    const { updateBoardTicketStatus } = await import('./boardTicketStatusActions');

    const updated = await updateBoardTicketStatus('board-a', 'status-a-closed', {
      is_closed: false,
      is_default: true,
    });

    expect(updated.status_id).toBe('status-a-closed');

    const boardADefaults = state.statuses.filter((status) => status.board_id === 'board-a' && status.is_default);
    const boardBDefaults = state.statuses.filter((status) => status.board_id === 'board-b' && status.is_default);

    expect(boardADefaults.map((status) => status.status_id)).toEqual(['status-a-closed']);
    expect(boardBDefaults.map((status) => status.status_id)).toEqual(['status-b-open']);
  });

  it('T026: deleting or closing the last valid open default on a board is rejected with a clear validation error', async () => {
    const { deleteBoardTicketStatus, updateBoardTicketStatus } = await import('./boardTicketStatusActions');

    await expect(
      updateBoardTicketStatus('board-b', 'status-b-open', { is_closed: true })
    ).rejects.toThrow('Select exactly one open default ticket status before saving the board.');

    await expect(
      deleteBoardTicketStatus('board-b', 'status-b-open')
    ).rejects.toThrow('Add at least one ticket status before saving the board.');
  });
});
