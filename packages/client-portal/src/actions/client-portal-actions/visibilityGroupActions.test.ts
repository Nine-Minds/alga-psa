import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const hasPermissionMock = vi.fn();
const revalidatePathMock = vi.fn();
const actorContactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const targetContactId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const preconfiguredContactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const clientId = '11111111-1111-4111-8111-111111111111';
const otherClientId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const secondGroupId = '44444444-4444-4444-8444-444444444444';
const boardIdOne = '55555555-5555-4555-8555-555555555555';
const boardIdTwo = '66666666-6666-4666-8666-666666666666';
const boardIdThree = '77777777-7777-4777-8777-777777777777';
const crossClientBoardId = '88888888-8888-4888-8888-888888888888';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: any[]) => revalidatePathMock(...args),
}));

describe('client portal visibility group actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      contact_id: actorContactId,
      tenant: 'tenant-1',
    };
    createTenantKnexMock.mockResolvedValue({ knex: {} as any });
    hasPermissionMock.mockResolvedValue(true);
  });

  it('T018: client portal admin can list visibility groups for their own client', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn((filters: Record<string, any>) => {
              if (filters.contact_name_id === actorContactId) {
                return {
                  select: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue({
                      client_id: clientId,
                      is_client_admin: true,
                    }),
                  })),
                };
              }

              return {
                whereIn: vi.fn(() => ({
                  select: vi.fn(() => ({
                    count: vi.fn(() => ({
                      groupBy: vi.fn().mockResolvedValue([
                        {
                          portal_visibility_group_id: groupId,
                          assigned_contact_count: 3,
                        },
                      ]),
                    })),
                  })),
                })),
              };
            }),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                orderBy: vi.fn().mockResolvedValue([
                  {
                    group_id: groupId,
                    client_id: clientId,
                    name: 'Standard Employees',
                    description: 'Default support boards',
                  },
                ]),
              })),
            })),
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return {
            where: vi.fn(() => ({
              whereIn: vi.fn(() => ({
                select: vi.fn(() => ({
                  count: vi.fn(() => ({
                    groupBy: vi.fn().mockResolvedValue([
                      { group_id: groupId, board_count: 2 },
                    ]),
                  })),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { getClientPortalVisibilityGroups } = await import('./visibilityGroupActions');
    const groups = await getClientPortalVisibilityGroups();

    expect(groups).toEqual([
      expect.objectContaining({
        group_id: groupId,
        board_count: 2,
        assigned_contact_count: 3,
      }),
    ]);
  });

  it('T019: non-admin client portal users are denied access to visibility group listing actions', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                first: vi.fn().mockResolvedValue({
                  client_id: clientId,
                  is_client_admin: false,
                }),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { getClientPortalVisibilityGroups } = await import('./visibilityGroupActions');

    await expect(getClientPortalVisibilityGroups()).rejects.toThrow(
      'Permission denied: Client portal admin access is required'
    );
  });

  it('T020: client portal admins cannot fetch visibility groups for a different client', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                first: vi.fn().mockResolvedValue({
                  client_id: clientId,
                  is_client_admin: true,
                }),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { getClientPortalVisibilityGroup } = await import('./visibilityGroupActions');

    await expect(
      getClientPortalVisibilityGroup(groupId, undefined, otherClientId)
    ).rejects.toThrow('Cannot manage visibility groups for another client');
  });

  it('T002: client portal admin board loading returns active tenant boards without requiring board client ownership', async () => {
    const boardsWhereMock = vi.fn(() => ({
      andWhere: vi.fn(() => ({
        select: vi.fn().mockResolvedValue([
          { board_id: boardIdOne, board_name: 'General Support' },
          { board_id: boardIdTwo, board_name: 'Projects' },
        ]),
      })),
    }));

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                first: vi.fn().mockResolvedValue({
                  client_id: clientId,
                  is_client_admin: true,
                }),
              })),
            })),
          };
        }

        if (table === 'boards') {
          return {
            where: boardsWhereMock,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { getClientPortalVisibilityGroupBoards } = await import('./visibilityGroupActions');
    const boards = await getClientPortalVisibilityGroupBoards();

    expect(boardsWhereMock).toHaveBeenCalledWith({ tenant: 'tenant-1' });
    expect(boards).toEqual([
      { board_id: boardIdOne, board_name: 'General Support' },
      { board_id: boardIdTwo, board_name: 'Projects' },
    ]);
  });

  it('T021: client portal admin can create a visibility group with selected board membership', async () => {
    const insertGroupMock = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ group_id: 'group-new' }]),
    });
    const insertGroupBoardsMock = vi.fn().mockResolvedValue(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                first: vi.fn().mockResolvedValue({
                  client_id: clientId,
                  is_client_admin: true,
                }),
              })),
            })),
          };
        }

        if (table === 'boards') {
          return {
            where: vi.fn(() => ({
              andWhere: vi.fn(() => ({
                whereIn: vi.fn(() => ({
                  select: vi.fn().mockResolvedValue([
                    { board_id: boardIdOne },
                    { board_id: boardIdTwo },
                  ]),
                })),
              })),
            })),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            insert: insertGroupMock,
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return {
            insert: insertGroupBoardsMock,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { createClientPortalVisibilityGroup } = await import('./visibilityGroupActions');
    const result = await createClientPortalVisibilityGroup({
      clientId,
      name: 'HR Contacts',
      description: 'Restricted HR boards',
      boardIds: [boardIdOne, boardIdTwo],
    });

    expect(result).toEqual({ group_id: 'group-new' });
    expect(insertGroupBoardsMock).toHaveBeenCalledWith([
      { tenant: 'tenant-1', group_id: 'group-new', board_id: boardIdOne },
      { tenant: 'tenant-1', group_id: 'group-new', board_id: boardIdTwo },
    ]);
    expect(revalidatePathMock).toHaveBeenCalledWith('/client-portal/client-settings?tab=visibility-groups');
  });

  it('T022: client portal admin can edit a group name and board membership', async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);
    const deleteBoardsMock = vi.fn().mockResolvedValue(undefined);
    const insertBoardsMock = vi.fn().mockResolvedValue(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                first: vi.fn().mockResolvedValue({
                  client_id: clientId,
                  is_client_admin: true,
                }),
              })),
            })),
          };
        }

        if (table === 'boards') {
          return {
            where: vi.fn(() => ({
              andWhere: vi.fn(() => ({
                whereIn: vi.fn(() => ({
                  select: vi.fn().mockResolvedValue([
                    { board_id: boardIdThree },
                  ]),
                })),
              })),
            })),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn((filters: Record<string, any>) => ({
              first: vi.fn().mockResolvedValue(
                filters.group_id === groupId ? { group_id: groupId } : undefined
              ),
              update: updateMock,
            })),
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return {
            where: vi.fn(() => ({
              whereIn: vi.fn(() => ({
                select: vi.fn().mockResolvedValue([]),
              })),
              delete: deleteBoardsMock,
            })),
            insert: insertBoardsMock,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { updateClientPortalVisibilityGroup } = await import('./visibilityGroupActions');
    await updateClientPortalVisibilityGroup(groupId, {
      name: 'Executives',
      description: 'Exec-only boards',
      boardIds: [boardIdThree],
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Executives',
        description: 'Exec-only boards',
      })
    );
    expect(deleteBoardsMock).toHaveBeenCalled();
    expect(insertBoardsMock).toHaveBeenCalledWith([
      { tenant: 'tenant-1', group_id: groupId, board_id: boardIdThree },
    ]);
  });

  it('T023: client portal admin cannot add boards from another client or tenant to a visibility group', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                first: vi.fn().mockResolvedValue({
                  client_id: clientId,
                  is_client_admin: true,
                }),
              })),
            })),
          };
        }

        if (table === 'boards') {
          return {
            where: vi.fn(() => ({
              andWhere: vi.fn(() => ({
                whereIn: vi.fn(() => ({
                  select: vi.fn().mockResolvedValue([{ board_id: boardIdOne }]),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { createClientPortalVisibilityGroup } = await import('./visibilityGroupActions');

    await expect(
      createClientPortalVisibilityGroup({
        clientId,
        name: 'Invalid',
        description: null,
        boardIds: [boardIdOne, crossClientBoardId],
      })
    ).rejects.toThrow('One or more boards are invalid for this tenant');
  });

  it('T003: client portal admin cannot include inactive boards when creating a visibility group', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                first: vi.fn().mockResolvedValue({
                  client_id: clientId,
                  is_client_admin: true,
                }),
              })),
            })),
          };
        }

        if (table === 'boards') {
          return {
            where: vi.fn(() => ({
              andWhere: vi.fn(() => ({
                whereIn: vi.fn(() => ({
                  select: vi.fn().mockResolvedValue([{ board_id: boardIdOne }]),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { createClientPortalVisibilityGroup } = await import('./visibilityGroupActions');

    await expect(
      createClientPortalVisibilityGroup({
        clientId,
        name: 'Inactive Board Rejection',
        description: null,
        boardIds: [boardIdOne, boardIdTwo],
      })
    ).rejects.toThrow('One or more boards are invalid for this tenant');
  });

  it('allows preserving inactive boards already assigned to a group during updates', async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);
    const deleteBoardsMock = vi.fn().mockResolvedValue(undefined);
    const insertBoardsMock = vi.fn().mockResolvedValue(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn(() => ({
              select: vi.fn(() => ({
                first: vi.fn().mockResolvedValue({
                  client_id: clientId,
                  is_client_admin: true,
                }),
              })),
            })),
          };
        }

        if (table === 'boards') {
          return {
            where: vi.fn(() => ({
              andWhere: vi.fn(() => ({
                whereIn: vi.fn(() => ({
                  select: vi.fn().mockResolvedValue([{ board_id: boardIdThree }]),
                })),
              })),
            })),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn((filters: Record<string, any>) => ({
              first: vi.fn().mockResolvedValue(
                filters.group_id === groupId ? { group_id: groupId } : undefined
              ),
              update: updateMock,
            })),
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return {
            where: vi.fn(() => ({
              whereIn: vi.fn(() => ({
                select: vi.fn().mockResolvedValue([{ board_id: boardIdTwo }]),
              })),
              delete: deleteBoardsMock,
            })),
            insert: insertBoardsMock,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { updateClientPortalVisibilityGroup } = await import('./visibilityGroupActions');
    await updateClientPortalVisibilityGroup(groupId, {
      name: 'Executives',
      description: 'Exec-only boards',
      boardIds: [boardIdTwo, boardIdThree],
    });

    expect(insertBoardsMock).toHaveBeenCalledWith([
      { tenant: 'tenant-1', group_id: groupId, board_id: boardIdTwo },
      { tenant: 'tenant-1', group_id: groupId, board_id: boardIdThree },
    ]);
  });

  it('T024: client portal admin can assign a visibility group to a contact in the same client', async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn((filters: Record<string, any>) => {
              if (filters.contact_name_id === targetContactId) {
                return {
                  first: vi.fn().mockResolvedValue({ client_id: clientId }),
                  select: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue({ client_id: clientId }),
                  })),
                  update: updateMock,
                };
              }

              return {
                select: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue({
                    client_id: clientId,
                    is_client_admin: true,
                  }),
                })),
              };
            }),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn(() => ({
              first: vi.fn().mockResolvedValue({ group_id: groupId }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { assignClientPortalVisibilityGroupToContact } = await import('./visibilityGroupActions');
    await assignClientPortalVisibilityGroupToContact({
      contactId: targetContactId,
      groupId,
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ portal_visibility_group_id: groupId })
    );
  });

  it('T025: client portal admin can clear a contact assignment back to full access', async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn((filters: Record<string, any>) => {
              if (filters.contact_name_id === targetContactId) {
                return {
                  first: vi.fn().mockResolvedValue({ client_id: clientId }),
                  select: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue({ client_id: clientId }),
                  })),
                  update: updateMock,
                };
              }

              return {
                select: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue({
                    client_id: clientId,
                    is_client_admin: true,
                  }),
                })),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { assignClientPortalVisibilityGroupToContact } = await import('./visibilityGroupActions');
    await assignClientPortalVisibilityGroupToContact({
      contactId: targetContactId,
      groupId: null,
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ portal_visibility_group_id: null })
    );
  });

  it('T027: a contact without a portal user can receive a visibility group assignment before invitation', async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn((filters: Record<string, any>) => {
              if (filters.contact_name_id === preconfiguredContactId) {
                return {
                  first: vi.fn().mockResolvedValue({ client_id: clientId }),
                  select: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue({ client_id: clientId }),
                  })),
                  update: updateMock,
                };
              }

              return {
                select: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue({
                    client_id: clientId,
                    is_client_admin: true,
                  }),
                })),
              };
            }),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn(() => ({
              first: vi.fn().mockResolvedValue({ group_id: groupId }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { assignClientPortalVisibilityGroupToContact } = await import('./visibilityGroupActions');
    await assignClientPortalVisibilityGroupToContact({
      contactId: preconfiguredContactId,
      groupId,
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ portal_visibility_group_id: groupId })
    );
  });

  it('T033: delete returns a validation result instead of throwing when the group is assigned to contacts', async () => {
    const deleteBoardsMock = vi.fn().mockResolvedValue(undefined);
    const deleteGroupsMock = vi.fn().mockResolvedValue(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn((filters: Record<string, any>) => {
              if (filters.portal_visibility_group_id === groupId) {
                return {
                  count: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue({ count: 1 }),
                  })),
                };
              }

              return {
                select: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue({
                    client_id: clientId,
                    is_client_admin: true,
                  }),
                })),
              };
            }),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn(() => ({
              first: vi.fn().mockResolvedValue({ group_id: groupId, client_id: clientId }),
              delete: deleteGroupsMock,
            })),
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return {
            where: vi.fn(() => ({
              delete: deleteBoardsMock,
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { deleteClientPortalVisibilityGroup } = await import('./visibilityGroupActions');
    const result = await deleteClientPortalVisibilityGroup(groupId);

    expect(result).toEqual({ ok: false, code: 'ASSIGNED_TO_CONTACTS' });
    expect(deleteBoardsMock).not.toHaveBeenCalled();
    expect(deleteGroupsMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('T034: delete succeeds and revalidates when the group is unassigned', async () => {
    const deleteBoardsMock = vi.fn().mockResolvedValue(undefined);
    const deleteGroupsMock = vi.fn().mockResolvedValue(1);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn((filters: Record<string, any>) => {
              if (filters.portal_visibility_group_id === groupId) {
                return {
                  count: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue({ count: 0 }),
                  })),
                };
              }

              return {
                select: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue({
                    client_id: clientId,
                    is_client_admin: true,
                  }),
                })),
              };
            }),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn(() => ({
              first: vi.fn().mockResolvedValue({ group_id: groupId, client_id: clientId }),
              delete: deleteGroupsMock,
            })),
          };
        }

        if (table === 'client_portal_visibility_group_boards') {
          return {
            where: vi.fn(() => ({
              delete: deleteBoardsMock,
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { deleteClientPortalVisibilityGroup } = await import('./visibilityGroupActions');
    const result = await deleteClientPortalVisibilityGroup(groupId);

    expect(result).toEqual({ ok: true });
    expect(deleteBoardsMock).toHaveBeenCalled();
    expect(deleteGroupsMock).toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith('/client-portal/client-settings?tab=visibility-groups');
  });

  it('T032: the latest client portal admin assignment wins without lock semantics', async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn((filters: Record<string, any>) => {
              if (filters.contact_name_id === targetContactId) {
                return {
                  first: vi.fn().mockResolvedValue({ client_id: clientId }),
                  select: vi.fn(() => ({
                    first: vi.fn().mockResolvedValue({
                      client_id: clientId,
                      portal_visibility_group_id: secondGroupId,
                    }),
                  })),
                  update: updateMock,
                };
              }

              return {
                select: vi.fn(() => ({
                  first: vi.fn().mockResolvedValue({
                    client_id: clientId,
                    is_client_admin: true,
                  }),
                })),
              };
            }),
          };
        }

        if (table === 'client_portal_visibility_groups') {
          return {
            where: vi.fn(() => ({
              first: vi.fn().mockResolvedValue({ group_id: groupId }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    const { assignClientPortalVisibilityGroupToContact } = await import('./visibilityGroupActions');
    await assignClientPortalVisibilityGroupToContact({
      contactId: targetContactId,
      groupId,
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ portal_visibility_group_id: groupId })
    );
  });
});
