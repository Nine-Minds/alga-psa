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
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
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

vi.mock('../lib/clientPortalVisibility', () => ({
  getClientContactVisibilityContext: (...args: any[]) => getClientContactVisibilityContextMock(...args),
}));

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
          return {
            where: vi.fn().mockReturnValue({
              andWhere: vi.fn().mockReturnValue({
                whereIn: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue([
                    { board_id: 'board-2', board_name: 'HR' },
                    { board_id: 'board-3', board_name: 'Support' },
                  ]),
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

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

  it('uses the first allowed board when loading priorities for the default selection', async () => {
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
          return {
            where: vi.fn().mockReturnValue({
              andWhere: vi.fn().mockReturnValue({
                whereIn: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue([
                    { board_id: 'board-7', board_name: 'VIP' },
                    { board_id: 'board-9', board_name: 'General' },
                  ]),
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getClientContactVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-7', 'board-9'],
    });

    const { getClientTicketFormData } = await import('./ticketFormActions');
    await getClientTicketFormData();

    expect(getPrioritiesByBoardTypeMock).toHaveBeenCalledWith('board-7', 'ticket');
  });

  it('T008: ticket creation board options exclude inactive boards even when visibility group includes them', async () => {
    const activeFilterMock = vi.fn(() => ({
      whereIn: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue([
          { board_id: 'board-active', board_name: 'Active Board' },
        ]),
      }),
    }));

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
          return {
            where: vi.fn().mockReturnValue({
              andWhere: activeFilterMock,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getClientContactVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-active', 'board-inactive'],
    });

    const { getClientTicketFormData } = await import('./ticketFormActions');
    const formData = await getClientTicketFormData();

    expect(formData.boards).toEqual([{ board_id: 'board-active', board_name: 'Active Board' }]);
    expect(activeFilterMock).toHaveBeenCalledWith('is_inactive', false);
  });
});
