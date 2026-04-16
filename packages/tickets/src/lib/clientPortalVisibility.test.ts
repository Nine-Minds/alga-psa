import { describe, expect, it, vi } from 'vitest';
import {
  VISIBILITY_GROUP_MISMATCH_ERROR,
  applyVisibilityBoardFilter,
  getClientContactVisibilityContext,
} from './clientPortalVisibility';

function makeQueryBuilder() {
  return {
    whereRaw: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
  } as any;
}

function buildTrx(params: {
  contact?: { contact_name_id: string; client_id: string | null; portal_visibility_group_id: string | null };
  group?: { group_id: string; client_id: string };
  boardIds?: string[];
}) {
  return ((table: string) => {
    if (table === 'contacts') {
      return {
        where: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(params.contact),
        }),
      };
    }

    if (table === 'client_portal_visibility_groups') {
      return {
        where: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(params.group),
        }),
      };
    }

    if (table === 'client_portal_visibility_group_boards as cvgb') {
      return {
        join: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue(
          (params.boardIds ?? []).map((boardId) => ({ board_id: boardId }))
        ),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

describe('client portal visibility resolver', () => {
  it('T005: returns unrestricted access when a contact has no assigned visibility group', async () => {
    const trx = buildTrx({
      contact: {
        contact_name_id: 'contact-1',
        client_id: 'client-1',
        portal_visibility_group_id: null,
      },
    });

    await expect(
      getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1')
    ).resolves.toEqual({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: null,
      visibleBoardIds: null,
    });
  });

  it('T006: returns exactly the assigned group board IDs for a restricted contact', async () => {
    const trx = buildTrx({
      contact: {
        contact_name_id: 'contact-1',
        client_id: 'client-1',
        portal_visibility_group_id: 'group-1',
      },
      group: {
        group_id: 'group-1',
        client_id: 'client-1',
      },
      boardIds: ['board-1', 'board-2'],
    });

    await expect(
      getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1')
    ).resolves.toEqual({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-1', 'board-2'],
    });
  });

  it('T007: rejects a group assignment that belongs to a different client', async () => {
    const trx = buildTrx({
      contact: {
        contact_name_id: 'contact-1',
        client_id: 'client-1',
        portal_visibility_group_id: 'group-2',
      },
      group: {
        group_id: 'group-2',
        client_id: 'client-2',
      },
    });

    await expect(
      getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1')
    ).rejects.toThrow(VISIBILITY_GROUP_MISMATCH_ERROR);
  });

  it('T011: returns an empty board list when an assigned visibility group has no board memberships', async () => {
    const trx = buildTrx({
      contact: {
        contact_name_id: 'contact-1',
        client_id: 'client-1',
        portal_visibility_group_id: 'group-empty',
      },
      group: {
        group_id: 'group-empty',
        client_id: 'client-1',
      },
      boardIds: [],
    });

    await expect(
      getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1')
    ).resolves.toEqual({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-empty',
      visibleBoardIds: [],
    });
  });

  it('fails closed for restricted groups with no valid boards and keeps the query chainable', () => {
    const query = makeQueryBuilder();
    expect(applyVisibilityBoardFilter(query, [])).toBe(query);
    expect(query.whereRaw).toHaveBeenCalledWith('1 = 0');
  });

  it('does not apply a board filter for unrestricted contacts', () => {
    const query = makeQueryBuilder();
    expect(applyVisibilityBoardFilter(query, null)).toBe(query);
    expect(query.whereRaw).not.toHaveBeenCalled();
    expect(query.whereIn).not.toHaveBeenCalled();
  });
});
