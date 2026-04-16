import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/utils/encryption', () => ({
  hashPassword: vi.fn(async () => 'hashed-password'),
}));

vi.mock('uuid', () => ({
  v4: () => 'user-uuid-1',
}));

import { createPortalUserInDBWithTrx } from '../../../../shared/models/userModel';
import { getClientContactVisibilityContext } from './clientPortalVisibility';

type UserModelState = {
  contacts: Array<{
    tenant: string;
    contact_name_id: string;
    client_id: string;
    portal_visibility_group_id: string | null;
    is_client_admin: boolean;
  }>;
  roles: Array<{
    role_id: string;
    tenant: string;
    client: boolean;
    msp: boolean;
    role_name: string;
  }>;
  users: Array<Record<string, any>>;
  userRoles: Array<Record<string, any>>;
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

function createUserModelTrx(state: UserModelState) {
  return ((table: string) => {
    if (table === 'contacts') {
      return {
        where: (filters: Record<string, any>) => {
          const matches = state.contacts.filter((row) => matchesFilters(row, filters));
          return {
            first: async (...columns: string[]) => pickFields(matches[0], columns),
          };
        },
      };
    }

    if (table === 'roles') {
      return {
        where: (filters: Record<string, any>) => {
          const matches = state.roles.filter((row) => matchesFilters(row, filters));
          return {
            first: async () => matches[0],
          };
        },
      };
    }

    if (table === 'users') {
      return {
        where: (filters: Record<string, any>) => {
          let matches = state.users.filter((row) => matchesFilters(row, filters));
          return {
            first: async () => matches[0],
            andWhere: (column: string, value: any) => {
              matches = matches.filter((row) => row[column] === value);
              return {
                first: async () => matches[0],
              };
            },
          };
        },
        insert: (payload: Record<string, any>) => ({
          returning: async () => {
            state.users.push(payload);
            return [payload];
          },
        }),
      };
    }

    if (table === 'user_roles') {
      return {
        insert: async (payload: Record<string, any>) => {
          state.userRoles.push(payload);
          return [payload];
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

describe('portal user creation preserves client portal visibility assignments', () => {
  let state: UserModelState;
  let trx: any;

  beforeEach(() => {
    state = {
      contacts: [],
      roles: [
        {
          role_id: 'role-user',
          tenant: 'tenant-1',
          client: true,
          msp: false,
          role_name: 'User',
        },
      ],
      users: [],
      userRoles: [],
      groups: [
        {
          tenant: 'tenant-1',
          group_id: 'group-1',
          client_id: 'client-a',
        },
      ],
      boards: [
        {
          tenant: 'tenant-1',
          board_id: 'board-1',
        },
      ],
      groupBoards: [
        {
          tenant: 'tenant-1',
          group_id: 'group-1',
          board_id: 'board-1',
        },
      ],
    };
    trx = createUserModelTrx(state);
  });

  it('T028: a preconfigured contact assignment remains effective after portal user creation links to that contact', async () => {
    state.contacts.push({
      tenant: 'tenant-1',
      contact_name_id: 'contact-1',
      client_id: 'client-a',
      portal_visibility_group_id: 'group-1',
      is_client_admin: false,
    });

    const result = await createPortalUserInDBWithTrx(trx, {
      email: 'assigned@example.com',
      password: 'Password123!',
      contactId: 'contact-1',
      clientId: 'client-a',
      tenantId: 'tenant-1',
      roleId: 'role-user',
    });

    expect(result).toMatchObject({
      success: true,
      roleId: 'role-user',
    });
    expect(result.userId).toEqual(expect.any(String));
    expect(state.users[0]).toMatchObject({
      contact_id: 'contact-1',
      email: 'assigned@example.com',
      user_type: 'client',
    });

    const visibility = await getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1');
    expect(visibility.visibilityGroupId).toBe('group-1');
    expect(visibility.visibleBoardIds).toEqual(['board-1']);
  });

  it('T038: unassigned contacts can still complete portal user onboarding with unrestricted ticket visibility', async () => {
    state.contacts.push({
      tenant: 'tenant-1',
      contact_name_id: 'contact-2',
      client_id: 'client-a',
      portal_visibility_group_id: null,
      is_client_admin: false,
    });

    const result = await createPortalUserInDBWithTrx(trx, {
      email: 'unassigned@example.com',
      password: 'Password123!',
      contactId: 'contact-2',
      clientId: 'client-a',
      tenantId: 'tenant-1',
      roleId: 'role-user',
    });

    expect(result.success).toBe(true);

    const visibility = await getClientContactVisibilityContext(trx, 'tenant-1', 'contact-2');
    expect(visibility.visibilityGroupId).toBeNull();
    expect(visibility.visibleBoardIds).toBeNull();
  });
});
