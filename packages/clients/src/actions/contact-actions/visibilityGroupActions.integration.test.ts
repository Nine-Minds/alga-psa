import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getClientContactVisibilityContext } from '../../../../tickets/src/lib/clientPortalVisibility';

const hasPermissionAsyncMock = vi.fn();
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'msp-user-1' }, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'msp-user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('../../lib/authHelpers', () => ({
  hasPermissionAsync: (...args: any[]) => hasPermissionAsyncMock(...args),
}));

type VisibilityState = {
  contacts: Array<{
    tenant: string;
    contact_name_id: string;
    client_id: string;
    portal_visibility_group_id: string | null;
  }>;
  groups: Array<{
    tenant: string;
    group_id: string;
    client_id: string;
  }>;
  boards: Array<{
    tenant: string;
    board_id: string;
    is_inactive?: boolean;
  }>;
  groupBoards: Array<{
    tenant: string;
    group_id: string;
    board_id: string;
  }>;
};

function pickFields<T extends Record<string, any>>(row: T | undefined, columns?: string[]) {
  if (!row) {
    return undefined;
  }

  if (!columns?.length) {
    return row;
  }

  return columns.reduce<Record<string, any>>((acc, column) => {
    const key = column.includes('.') ? column.split('.').pop()! : column;
    acc[key] = row[key];
    return acc;
  }, {});
}

function matchesFilters(row: Record<string, any>, filters: Record<string, any>) {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

function createVisibilityTrx(state: VisibilityState) {
  return ((table: string) => {
    if (table === 'contacts') {
      return {
        where: (filters: Record<string, any>) => {
          const matches = state.contacts.filter((row) => matchesFilters(row, filters));
          return {
            first: async (...columns: string[]) => pickFields(matches[0], columns),
            update: async (updates: Record<string, any>) => {
              matches.forEach((row) => Object.assign(row, updates));
              return matches.length;
            },
          };
        },
      };
    }

    if (table === 'client_portal_visibility_groups') {
      return {
        where: (filters: Record<string, any>) => {
          const matches = state.groups.filter((row) => matchesFilters(row, filters));
          return {
            first: async (...columns: string[]) => pickFields(matches[0], columns),
          };
        },
      };
    }

    if (table === 'client_portal_visibility_group_boards as cvgb') {
      return {
        join: () => ({
          where: (filters: Record<string, any>) => ({
            select: async () =>
              state.groupBoards
                .filter((row) => {
                  const board = state.boards.find((candidate) => candidate.board_id === row.board_id);
                  return (
                    row.tenant === filters['cvgb.tenant'] &&
                    row.group_id === filters['cvgb.group_id'] &&
                    board?.tenant === filters['cvgb.tenant']
                  );
                })
                .map((row) => ({ board_id: row.board_id })),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

describe('contactActions visibility group integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionAsyncMock.mockResolvedValue(true);
  });

  it('T031: MSP assignment replacement is immediately reflected in client portal visibility resolution', async () => {
    const state: VisibilityState = {
      contacts: [
        {
          tenant: 'tenant-1',
          contact_name_id: 'contact-1',
          client_id: 'client-a',
          portal_visibility_group_id: 'group-1',
        },
      ],
      groups: [
        { tenant: 'tenant-1', group_id: 'group-1', client_id: 'client-a' },
        { tenant: 'tenant-1', group_id: 'group-2', client_id: 'client-a' },
      ],
      boards: [
        { tenant: 'tenant-1', board_id: 'board-1' },
        { tenant: 'tenant-1', board_id: 'board-2' },
      ],
      groupBoards: [
        { tenant: 'tenant-1', group_id: 'group-1', board_id: 'board-1' },
        { tenant: 'tenant-1', group_id: 'group-2', board_id: 'board-2' },
      ],
    };

    const trx = createVisibilityTrx(state);
    withTransactionMock.mockImplementation(async (_db: any, callback: (innerTrx: any) => Promise<unknown>) =>
      callback(trx)
    );

    const initialVisibility = await getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1');
    expect(initialVisibility.visibleBoardIds).toEqual(['board-1']);

    const { assignClientPortalVisibilityGroupToContact } = await import('./contactActions');
    await assignClientPortalVisibilityGroupToContact('contact-1', 'group-2');

    const updatedVisibility = await getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1');
    expect(updatedVisibility.visibilityGroupId).toBe('group-2');
    expect(updatedVisibility.visibleBoardIds).toEqual(['board-2']);
  });

  it('T001: MSP board loading returns active tenant boards without requiring board client ownership', async () => {
    const boardsWhereMock = vi.fn(() => ({
      andWhere: vi.fn(() => ({
        select: vi.fn().mockResolvedValue([
          { board_id: 'board-1', board_name: 'General Support' },
          { board_id: 'board-2', board_name: 'Projects' },
        ]),
      })),
    }));

    withTransactionMock.mockImplementation(async (_db: any, callback: (innerTrx: any) => Promise<unknown>) =>
      callback(
        ((table: string) => {
          if (table === 'contacts') {
            return {
              where: () => ({
                first: async () => ({ contact_name_id: 'contact-1', client_id: 'client-a' }),
              }),
            };
          }

          if (table === 'boards') {
            return {
              where: boardsWhereMock,
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        }) as any
      )
    );

    const { getClientPortalVisibilityBoardsByClient } = await import('./contactActions');
    const boards = await getClientPortalVisibilityBoardsByClient('contact-1');

    expect(boardsWhereMock).toHaveBeenCalledWith({ tenant: 'tenant-1' });
    expect(boards).toEqual([
      { board_id: 'board-1', board_name: 'General Support' },
      { board_id: 'board-2', board_name: 'Projects' },
    ]);
  });
});
