import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const getPrioritiesByBoardTypeMock = vi.fn();
const getClientContactVisibilityContextMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    tenantJoin: (query: any) => query.join?.() ?? query,
  }),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: vi.fn(),
  getAllPriorities: vi.fn(),
  getPrioritiesByBoardType: (...args: any[]) => getPrioritiesByBoardTypeMock(...args),
}));

vi.mock('@alga-psa/reference-data/actions/priorityActions', () => ({
  getTicketStatuses: vi.fn(),
  getAllPriorities: vi.fn(),
  getPrioritiesByBoardType: (...args: any[]) => getPrioritiesByBoardTypeMock(...args),
}));

vi.mock('./clientLookupActions', () => ({
  getAllClients: vi.fn(),
  getClientById: vi.fn(),
  getContactsByClient: vi.fn(),
}));

vi.mock('./board-actions', () => ({
  getAllBoards: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsers: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsers: vi.fn(),
}));

vi.mock('../lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: (...args: any[]) => getClientContactVisibilityContextMock(...args),
}));

type BoardRow = { board_id: string; board_name: string; is_inactive?: boolean; is_default?: boolean; display_order?: number };

/** In-memory boards table honoring the where/whereIn/modify/orderBy chain the loader issues. */
function makeBoardsTable(rows: BoardRow[]) {
  let result = rows;
  const builder: any = {
    where: vi.fn((column: string, value: unknown) => {
      result = result.filter((row) => (row as any)[column] === value || (value === false && (row as any)[column] === undefined));
      return builder;
    }),
    whereIn: vi.fn((column: string, values: string[]) => {
      result = result.filter((row) => values.includes((row as any)[column]));
      return builder;
    }),
    modify: vi.fn((callback: (query: any) => void) => {
      callback(builder);
      return builder;
    }),
    orderBy: vi.fn(() => {
      result = [...result].sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)));
      return builder;
    }),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function mockTransaction(boards: BoardRow[]) {
  withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
    const trx = (table: string) => {
      if (table === 'users') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ contact_id: 'contact-1' }),
          }),
        };
      }
      if (table === 'boards') {
        return makeBoardsTable(boards);
      }
      throw new Error(`Unexpected table: ${table}`);
    };
    return callback(trx);
  });
}

describe('client ticket form visibility restrictions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'client-user-1',
      tenant: 'tenant-1',
    };
    createTenantKnexMock.mockResolvedValue({ knex: {} as any });
    getPrioritiesByBoardTypeMock.mockResolvedValue([
      { priority_id: 'priority-1', priority_name: 'Medium' },
    ]);
  });

  it('T013: ticket creation form only lists boards allowed by the assigned visibility group', async () => {
    mockTransaction([
      { board_id: 'board-1', board_name: 'Internal' },
      { board_id: 'board-2', board_name: 'HR' },
      { board_id: 'board-3', board_name: 'Support' },
    ]);

    getClientContactVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-2', 'board-3'],
    });

    const { getClientTicketFormData } = await import('./ticketFormActions');
    const formData = await getClientTicketFormData();

    expect(formData.boards).toEqual([
      { board_id: 'board-2', board_name: 'HR' },
      { board_id: 'board-3', board_name: 'Support' },
    ]);
  });

  it('orders the tenant default board first and loads its priorities', async () => {
    mockTransaction([
      { board_id: 'board-7', board_name: 'VIP' },
      { board_id: 'board-9', board_name: 'General', is_default: true },
    ]);

    getClientContactVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-7', 'board-9'],
    });

    const { getClientTicketFormData } = await import('./ticketFormActions');
    const formData = await getClientTicketFormData();

    expect(formData.boards?.map((board) => board.board_id)).toEqual(['board-9', 'board-7']);
    expect(getPrioritiesByBoardTypeMock).toHaveBeenCalledWith('board-9', 'ticket');
  });

  it('T008: ticket creation board options exclude inactive boards even when visibility group includes them', async () => {
    mockTransaction([
      { board_id: 'board-active', board_name: 'Active Board', is_inactive: false },
      { board_id: 'board-inactive', board_name: 'Retired', is_inactive: true },
    ]);

    getClientContactVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-active', 'board-inactive'],
    });

    const { getClientTicketFormData } = await import('./ticketFormActions');
    const formData = await getClientTicketFormData();

    expect(formData.boards?.map((board) => board.board_id)).toEqual(['board-active']);
  });

  it('returns no boards when the visibility context allows none', async () => {
    mockTransaction([{ board_id: 'board-1', board_name: 'Support' }]);
    getClientContactVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: [],
    });

    const { getClientTicketFormData } = await import('./ticketFormActions');
    const formData = await getClientTicketFormData();

    expect(formData.boards).toEqual([]);
    expect(getPrioritiesByBoardTypeMock).not.toHaveBeenCalled();
  });

  it('getClientTicketPrioritiesForBoard refuses boards outside the visible set', async () => {
    mockTransaction([
      { board_id: 'board-1', board_name: 'Support' },
      { board_id: 'board-2', board_name: 'Internal' },
    ]);
    getClientContactVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-1'],
    });

    const { getClientTicketPrioritiesForBoard } = await import('./ticketFormActions');

    await expect(getClientTicketPrioritiesForBoard('board-2')).resolves.toEqual([]);
    expect(getPrioritiesByBoardTypeMock).not.toHaveBeenCalled();

    await expect(getClientTicketPrioritiesForBoard('board-1')).resolves.toHaveLength(1);
    expect(getPrioritiesByBoardTypeMock).toHaveBeenCalledWith('board-1', 'ticket');
  });
});
