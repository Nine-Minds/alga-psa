import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionAsyncMock = vi.fn();
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const tenantDbMock = vi.fn((conn: any, _tenant?: string) => ({
  table: (table: string) => conn(table),
}));
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  tenantDb: (conn: any, tenant: string) => tenantDbMock(conn, tenant),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('../../lib/authHelpers', () => ({
  hasPermissionAsync: (...args: any[]) => hasPermissionAsyncMock(...args),
  isMspUser: (user: any) => user?.user_type === 'internal',
  isClientPortalUser: (user: any) => user?.user_type === 'client',
  hasMspPermission: async (user: any, resource: string, action: string, db?: any) =>
    user?.user_type === 'internal' && await hasPermissionAsyncMock(user, resource, action, db),
  assertMspPermission: async (user: any, resource: string, action: string, message: string, db?: any) => {
    if (!(user?.user_type === 'internal' && await hasPermissionAsyncMock(user, resource, action, db))) {
      throw new Error(message);
    }
  },
  assertMspOrClientPortalOwnClientPermission: async (user: any, _tenant: string, _clientId: string, resource: string, action: string, message: string, db?: any) => {
    if (!(user?.user_type === 'internal' && await hasPermissionAsyncMock(user, resource, action, db))) {
      throw new Error(message);
    }
  },
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTag: vi.fn(),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {},
}));

vi.mock('../../lib/documentsHelpers', () => ({
  getContactAvatarUrlsBatchAsync: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildContactArchivedPayload: vi.fn(),
  buildContactCreatedPayload: vi.fn(),
  buildContactUpdatedPayload: vi.fn(),
}));

describe('contactActions visibility group assignment/delete guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionAsyncMock.mockResolvedValue(true);
  });

  it('T026: cannot assign a contact to a visibility group outside their client', async () => {
    const contactsWhereMock = vi.fn(() => ({
      first: vi.fn(async () => ({ contact_name_id: 'contact-1', client_id: 'client-a' })),
      update: vi.fn(async () => 1)
    }));
    const groupWhereMock = vi.fn(() => ({ first: vi.fn(async () => undefined) }));

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<unknown>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return { where: contactsWhereMock };
        }

        if (table === 'client_portal_visibility_groups') {
          return { where: groupWhereMock };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { assignClientPortalVisibilityGroupToContact } = await import('./contactActions');

    await expect(
      assignClientPortalVisibilityGroupToContact('contact-1', 'group-cross-client')
    ).resolves.toEqual({ actionError: 'Assigned visibility group is invalid for this contact' });

    expect(contactsWhereMock).toHaveBeenCalled();
    expect(groupWhereMock).toHaveBeenCalled();
  });

  it('T033: blocks deleting a visibility group still assigned to contacts', async () => {
    const groupDeleteMock = vi.fn(async () => 1);
    const groupWhereMock = vi.fn(() => ({
      first: vi.fn(async () => ({ group_id: 'group-1' })),
      delete: groupDeleteMock,
    }));
    const contactsWhereMock = vi.fn((filters: Record<string, any>) => {
      if ('portal_visibility_group_id' in filters) {
        return {
          count: vi.fn(() => ({ first: vi.fn(async () => ({ count: 2 })) }))
        };
      }

      return {
        first: vi.fn(async () => ({ contact_name_id: 'contact-1', client_id: 'client-a' }))
      };
    });
    const groupBoardsDeleteMock = vi.fn(async () => 1);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<unknown>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return { where: contactsWhereMock };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: groupWhereMock,
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return { where: vi.fn(() => ({ delete: groupBoardsDeleteMock })) };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { deleteClientPortalVisibilityGroupForContact } = await import('./contactActions');

    await expect(
      deleteClientPortalVisibilityGroupForContact('contact-1', 'group-1')
    ).resolves.toEqual({ actionError: 'Cannot delete visibility group while it is assigned to contacts' });

    expect(groupWhereMock).toHaveBeenCalled();
    expect(contactsWhereMock).toHaveBeenCalled();
    expect(groupBoardsDeleteMock).not.toHaveBeenCalled();
    expect(groupDeleteMock).not.toHaveBeenCalled();
  });

  it('T034: allows deleting an unassigned visibility group', async () => {
    const groupDeleteMock = vi.fn(async () => 1);
    const groupWhereMock = vi.fn(() => ({
      first: vi.fn(async () => ({ group_id: 'group-2' })),
      delete: groupDeleteMock,
    }));
    const contactsWhereMock = vi.fn((filters: Record<string, any>) => {
      if ('portal_visibility_group_id' in filters) {
        return {
          count: vi.fn(() => ({ first: vi.fn(async () => ({ count: 0 })) }))
        };
      }

      return {
        first: vi.fn(async () => ({ contact_name_id: 'contact-1', client_id: 'client-a' }))
      };
    });
    const groupBoardsDeleteMock = vi.fn(async () => 1);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<unknown>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return { where: contactsWhereMock };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: groupWhereMock,
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return { where: vi.fn(() => ({ delete: groupBoardsDeleteMock })) };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { deleteClientPortalVisibilityGroupForContact } = await import('./contactActions');

    await expect(
      deleteClientPortalVisibilityGroupForContact('contact-1', 'group-2')
    ).resolves.toBeUndefined();

    expect(groupBoardsDeleteMock).toHaveBeenCalled();
    expect(groupDeleteMock).toHaveBeenCalled();
    expect(contactsWhereMock).toHaveBeenCalled();
  });

  it('allows preserving inactive boards already assigned to a group during MSP-side updates', async () => {
    const groupUpdateMock = vi.fn(async () => 1);
    const groupBoardsInsertMock = vi.fn(async () => 1);
    const groupBoardsDeleteMock = vi.fn(async () => 1);
    const contactsWhereMock = vi.fn(() => ({
      first: vi.fn(async () => ({ contact_name_id: 'contact-1', client_id: 'client-a' })),
    }));

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<unknown>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return { where: contactsWhereMock };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn(() => ({
              first: vi.fn(async () => ({ group_id: 'group-1' })),
              update: groupUpdateMock,
            })),
          };
        }

        if (table === 'boards') {
          const activeBoardChain = {
            whereIn: vi.fn(() => ({
              select: vi.fn(async () => [{ board_id: 'board-active' }]),
            })),
          };

          return {
            where: vi.fn(() => ({
              andWhere: vi.fn(() => activeBoardChain),
            })),
            andWhere: vi.fn(() => activeBoardChain),
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return {
            where: vi.fn(() => ({
              whereIn: vi.fn(() => ({
                select: vi.fn(async () => [{ board_id: 'board-inactive' }]),
              })),
              delete: groupBoardsDeleteMock,
            })),
            insert: groupBoardsInsertMock,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { updateClientPortalVisibilityGroupForContact } = await import('./contactActions');

    await expect(
      updateClientPortalVisibilityGroupForContact('contact-1', 'group-1', {
        name: 'Updated Group',
        description: 'Keeps inactive memberships',
        boardIds: ['board-inactive', 'board-active'],
      })
    ).resolves.toBeUndefined();

    expect(groupUpdateMock).toHaveBeenCalled();
    expect(groupBoardsDeleteMock).toHaveBeenCalled();
    expect(groupBoardsInsertMock).toHaveBeenCalledWith([
      { tenant: 'tenant-1', group_id: 'group-1', board_id: 'board-inactive' },
      { tenant: 'tenant-1', group_id: 'group-1', board_id: 'board-active' },
    ]);
  });
});
