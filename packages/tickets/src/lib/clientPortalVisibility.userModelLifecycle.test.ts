import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/utils/encryption', () => ({
  hashPassword: vi.fn(async () => 'hashed-password'),
}));

vi.mock('uuid', () => ({
  v4: () => 'user-uuid-1',
}));

vi.mock('@alga-psa/db', () => ({
  assertClientPortalContactAvailable: vi.fn(async () => undefined),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    tenantJoin: (query: any) => query.join?.() ?? query,
  }),
  // The shared user_roles write from @alga-psa/db (alga-2026-0003347). It
  // carries the linked contact's portal-admin flag, re-derived from the roles
  // the user ends up holding, so onboarding with a non-admin role clears a
  // contact that was only pre-seeded as an admin by its invitation. Mirrored
  // here against the fake tables so this suite sees the end state production
  // sees; the helper itself is covered by packages/db/src/lib/userRoleWrites.test.ts.
  addUserRoles: async (trx: any, tenant: string, userId: string, roleIds: string[]) => {
    const rows = roleIds.map((role_id: string) => ({ tenant, user_id: userId, role_id }));
    for (const row of rows) {
      await trx('user_roles').insert(row);
    }

    const user = await trx('users').where({ tenant, user_id: userId }).first();
    if (user?.user_type === 'client' && user.contact_id) {
      const assigned = await Promise.all(
        rows.map((row) => trx('roles').where({ tenant, role_id: row.role_id }).first())
      );
      const isClientAdmin = assigned.some(
        (role: any) => role?.client === true && String(role?.role_name).toLowerCase() === 'admin'
      );
      await trx('contacts')
        .where({ tenant, contact_name_id: user.contact_id })
        .update({ is_client_admin: isClientAdmin });
    }

    return rows;
  },
}));

import { createPortalUserInDBWithTrx } from '../../../../shared/models/userModel';
import { getClientContactVisibilityContext } from './clientPortalVisibility.server';

type UserModelState = {
  contacts: Array<{
    tenant: string;
    contact_name_id: string;
    client_id: string;
    portal_visibility_group_id: string | null;
    is_client_admin: boolean;
    contact_kind?: 'person' | 'shared_mailbox';
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
    ticket_scope: 'client' | 'contact';
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
            // Hierarchy edges: onboarding never sets a manager.
            whereNotNull: () => ({ select: async () => [] }),
            update: async (patch: Record<string, any>) => {
              matches.forEach((row) => Object.assign(row, patch));
              return matches.length;
            },
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

    if (table === 'boards') {
      return {
        select: async () =>
          state.boards.map((board) => ({ board_id: board.board_id, client_portal_visible: true })),
      };
    }

    // Onboarding creates no billing-profile ticket grants, so a freshly
    // provisioned contact-scoped user still sees only their own tickets.
    if (table === 'client_billing_profiles' || table === 'billing_profile_contacts') {
      return {
        where: () => ({ select: async () => [] }),
      };
    }

    // Nor any shared-workspace membership (FR-E7 / FR-E7b).
    if (table === 'asset_associations as aa' || table === 'asset_group_members as m') {
      return {
        where: () => ({ whereIn: () => ({ distinct: async () => [] }) }),
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
                    (!filters['cvgb.tenant'] || row.tenant === filters['cvgb.tenant']) &&
                    row.group_id === filters['cvgb.group_id'] &&
                    (!filters['cvgb.tenant'] || board?.tenant === filters['cvgb.tenant'])
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
        {
          role_id: 'role-admin',
          tenant: 'tenant-1',
          client: true,
          msp: false,
          role_name: 'Admin',
        },
      ],
      users: [],
      userRoles: [],
      groups: [
        {
          tenant: 'tenant-1',
          group_id: 'group-1',
          client_id: 'client-a',
          ticket_scope: 'client',
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

  // The portal role onboarding assigns is what `contacts.is_client_admin`
  // mirrors (alga-2026-0003347), so an admin contact onboards with the client
  // 'Admin' role; the flag the fixture pre-seeds only picks that role.
  it.each([
    { ticketScope: 'client', isClientAdmin: false, roleId: 'role-user', effectiveTicketScope: 'client' },
    { ticketScope: 'client', isClientAdmin: true, roleId: 'role-admin', effectiveTicketScope: 'client' },
    { ticketScope: 'contact', isClientAdmin: false, roleId: 'role-user', effectiveTicketScope: 'contact' },
    { ticketScope: 'contact', isClientAdmin: true, roleId: 'role-admin', effectiveTicketScope: 'client' },
  ] as const)('T028: onboarding preserves $ticketScope scope and boards (admin=$isClientAdmin)', async ({
    ticketScope,
    isClientAdmin,
    roleId,
    effectiveTicketScope,
  }) => {
    state.groups[0].ticket_scope = ticketScope;
    state.contacts.push({
      tenant: 'tenant-1',
      contact_name_id: 'contact-1',
      client_id: 'client-a',
      portal_visibility_group_id: 'group-1',
      is_client_admin: isClientAdmin,
    });

    const result = await createPortalUserInDBWithTrx(trx, {
      email: 'assigned@example.com',
      password: 'Password123!',
      contactId: 'contact-1',
      clientId: 'client-a',
      tenantId: 'tenant-1',
      roleId,
    });

    expect(result).toMatchObject({
      success: true,
      roleId,
    });
    expect(result.userId).toEqual(expect.any(String));
    expect(state.users[0]).toMatchObject({
      contact_id: 'contact-1',
      email: 'assigned@example.com',
      user_type: 'client',
    });

    const visibility = await getClientContactVisibilityContext(trx, 'tenant-1', state.users[0].contact_id);
    expect(visibility).toEqual({
      ticketScope,
      effectiveTicketScope,
      isClientAdmin,
      contactId: 'contact-1',
      clientId: 'client-a',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-1'],
      // A brand-new portal user holds no billing-profile ticket grants.
      grantedTicketProfileIds: [],
      defaultBillingProfileId: null,
      // The fixture group predates asset/project scope: the column default applies.
      assetScope: 'client',
      effectiveAssetScope: 'client',
      projectScope: 'client',
      effectiveProjectScope: 'client',
      // Contact scope adds the (empty) hierarchy, the watcher grant and the
      // (empty) shared-workspace ticket list; admins and client-scoped users
      // get none of them.
      ...(effectiveTicketScope === 'contact'
        ? { visibleContactIds: ['contact-1'], watchGrant: true, workspaceTicketIds: [] }
        : {}),
    });
  });

  // alga-2026-0003347: the pre-seeded flag only survives onboarding if the
  // assigned role agrees. Onboarded with the plain 'User' role, the contact
  // stops being a portal admin and narrows back to its group's own scope —
  // otherwise the user would keep reading the whole client's tickets.
  it('onboarding with a non-admin role clears the contact pre-seeded as portal admin', async () => {
    state.groups[0].ticket_scope = 'contact';
    state.contacts.push({
      tenant: 'tenant-1',
      contact_name_id: 'contact-1',
      client_id: 'client-a',
      portal_visibility_group_id: 'group-1',
      is_client_admin: true,
    });

    const result = await createPortalUserInDBWithTrx(trx, {
      email: 'demoted@example.com',
      password: 'Password123!',
      contactId: 'contact-1',
      clientId: 'client-a',
      tenantId: 'tenant-1',
      roleId: 'role-user',
    });

    expect(result).toMatchObject({ success: true, roleId: 'role-user' });
    expect(state.contacts[0].is_client_admin).toBe(false);

    const visibility = await getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1');
    expect(visibility.isClientAdmin).toBe(false);
    expect(visibility.effectiveTicketScope).toBe('contact');
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
    expect(visibility.ticketScope).toBe('client');
    expect(visibility.effectiveTicketScope).toBe('client');
  });

  it('rejects client portal user creation for shared mailbox contacts', async () => {
    state.contacts.push({
      tenant: 'tenant-1',
      contact_name_id: 'contact-shared',
      client_id: 'client-a',
      portal_visibility_group_id: null,
      is_client_admin: false,
      contact_kind: 'shared_mailbox',
    });

    const result = await createPortalUserInDBWithTrx(trx, {
      email: 'shared@example.com', password: 'Password123!', contactId: 'contact-shared',
      clientId: 'client-a', tenantId: 'tenant-1', roleId: 'role-user',
    });

    expect(result).toMatchObject({
      success: false,
      error: 'Shared mailbox contacts cannot have a client portal user.',
    });
    expect(state.users).toHaveLength(0);
  });
});
