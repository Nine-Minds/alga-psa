import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    tenantJoin: (query: any) => query.join?.() ?? query,
  }),
}));

import {
  VISIBILITY_GROUP_MISMATCH_ERROR,
  applyTicketVisibilityFilter,
} from './clientPortalVisibility';
import { getClientContactVisibilityContext } from './clientPortalVisibility.server';

function makeQueryBuilder() {
  return {
    where: vi.fn().mockReturnThis(),
    whereRaw: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
  } as any;
}

function buildTrx(params: {
  contact?: { contact_name_id: string; client_id: string | null; portal_visibility_group_id: string | null; is_client_admin?: boolean };
  group?: { group_id: string; client_id: string; ticket_scope?: 'client' | 'contact' };
  boardIds?: string[];
  boards?: Array<{ board_id: string; client_portal_visible: boolean }>;
}) {
  return ((table: string) => {
    if (table === 'boards') {
      return {
        select: vi.fn().mockResolvedValue(params.boards ?? []),
      };
    }

    if (table === 'contacts') {
      return {
        where: vi.fn().mockReturnValue({
          modify(callback: (query: any) => void) { callback(this); return this; },
          forShare: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(params.contact),
        }),
      };
    }

    if (table === 'client_portal_visibility_groups') {
      return {
        where: vi.fn().mockReturnValue({
          modify(callback: (query: any) => void) { callback(this); return this; },
          forShare: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(params.group && { ticket_scope: 'client', ...params.group }),
        }),
      };
    }

    if (table === 'client_portal_visibility_group_boards as cvgb') {
      return {
        modify(callback: (query: any) => void) { callback(this); return this; },
        forShare: vi.fn().mockReturnThis(),
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

const baseVisibility = { ticketScope: 'client' as const, effectiveTicketScope: 'client' as const, isClientAdmin: false, contactId: 'contact-1', clientId: 'client-1', visibilityGroupId: null, visibleBoardIds: null };
const columns = { boardColumn: 't.board_id', contactColumn: 't.contact_name_id' };

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
      ticketScope: 'client',
      effectiveTicketScope: 'client',
      isClientAdmin: false,
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
      ticketScope: 'client',
      effectiveTicketScope: 'client',
      isClientAdmin: false,
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
      ticketScope: 'client',
      effectiveTicketScope: 'client',
      isClientAdmin: false,
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-empty',
      visibleBoardIds: [],
    });
  });

  it('fails closed for restricted groups with no valid boards and keeps the query chainable', () => {
    const query = makeQueryBuilder();
    expect(applyTicketVisibilityFilter(query, { ...baseVisibility, visibleBoardIds: [] }, columns)).toBe(query);
    expect(query.whereRaw).toHaveBeenCalledWith('1 = 0');
  });

  it('does not apply a board filter for unrestricted contacts', () => {
    const query = makeQueryBuilder();
    expect(applyTicketVisibilityFilter(query, baseVisibility, columns)).toBe(query);
    expect(query.whereRaw).not.toHaveBeenCalled();
    expect(query.whereIn).not.toHaveBeenCalled();
  });

  it('drops boards hidden from the client portal even when the assigned group includes them', async () => {
    const trx = buildTrx({
      contact: { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: 'group-1' },
      group: { group_id: 'group-1', client_id: 'client-1' },
      boardIds: ['board-1', 'board-2'],
      boards: [
        { board_id: 'board-1', client_portal_visible: true },
        { board_id: 'board-2', client_portal_visible: false },
      ],
    });

    await expect(
      getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1')
    ).resolves.toMatchObject({ visibleBoardIds: ['board-1'] });
  });

  it('materializes the allow-list for unassigned contacts when any board is hidden from the portal', async () => {
    const trx = buildTrx({
      contact: { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: null },
      boards: [
        { board_id: 'board-1', client_portal_visible: true },
        { board_id: 'board-2', client_portal_visible: false },
        { board_id: 'board-3', client_portal_visible: true },
      ],
    });

    await expect(
      getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1')
    ).resolves.toMatchObject({ visibilityGroupId: null, visibleBoardIds: ['board-1', 'board-3'] });
  });
});

describe('contact scope', () => {
  it.each([false, true])('resolves the admin override once (admin=%s), preserving boards', async (admin) => {
    const result = await getClientContactVisibilityContext(buildTrx({
      contact: { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: 'g', is_client_admin: admin },
      group: { group_id: 'g', client_id: 'client-1', ticket_scope: 'contact' },
      boardIds: ['board-1'],
    }), 'tenant-1', 'contact-1');
    expect(result).toMatchObject({ ticketScope: 'contact', effectiveTicketScope: admin ? 'client' : 'contact', isClientAdmin: admin, visibleBoardIds: ['board-1'] });
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(query, result, columns);
    expect(query.whereIn).toHaveBeenCalledWith('t.board_id', ['board-1']);
    if (admin) expect(query.where).not.toHaveBeenCalled();
    else expect(query.where).toHaveBeenCalledWith('t.contact_name_id', 'contact-1');
  });

  it('fails closed when the group is missing or its scope is invalid', async () => {
    const contact = { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: 'g' };
    await expect(getClientContactVisibilityContext(buildTrx({ contact }), 'tenant-1', 'contact-1')).rejects.toThrow('missing or inaccessible');
    await expect(getClientContactVisibilityContext(buildTrx({ contact, group: { group_id: 'g', client_id: 'client-1', ticket_scope: 'bad' as any } }), 'tenant-1', 'contact-1')).rejects.toThrow('invalid ticket scope');
  });
});

/**
 * Regression guard for the merge that moved this implementation into
 * `shared/lib/tickets`. A re-export shim that loses the contact predicate type
 * checks and passes every board test, so these cases assert the predicate
 * itself: contact scoping is an effect, not a guard.
 */
describe('contact scoping is enforced, not merely declared', () => {
  const contactScoped = {
    ...baseVisibility,
    ticketScope: 'contact' as const,
    effectiveTicketScope: 'contact' as const,
    visibilityGroupId: 'group-1',
  };

  it('constrains a non-admin contact-scoped context to its own contact', () => {
    const query = makeQueryBuilder();
    expect(applyTicketVisibilityFilter(query, contactScoped, columns)).toBe(query);
    expect(query.where).toHaveBeenCalledWith('t.contact_name_id', 'contact-1');
  });

  it('constrains by contact alongside the board allow-list', () => {
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(query, { ...contactScoped, visibleBoardIds: ['board-1'] }, columns);
    expect(query.whereIn).toHaveBeenCalledWith('t.board_id', ['board-1']);
    expect(query.where).toHaveBeenCalledWith('t.contact_name_id', 'contact-1');
  });

  it('honours the caller-supplied contact column rather than a hard-coded one', () => {
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(query, contactScoped, {
      boardColumn: 'tickets.board_id',
      contactColumn: 'tickets.contact_name_id',
    });
    expect(query.where).toHaveBeenCalledWith('tickets.contact_name_id', 'contact-1');
  });

  it('does not constrain by contact for a client admin whose scope resolved to client', () => {
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(
      query,
      { ...contactScoped, effectiveTicketScope: 'client', isClientAdmin: true },
      columns
    );
    expect(query.where).not.toHaveBeenCalled();
  });

  it('fails closed on an absent or unrecognised effective scope', () => {
    expect(() =>
      applyTicketVisibilityFilter(makeQueryBuilder(), { ...baseVisibility, effectiveTicketScope: undefined as any }, columns)
    ).toThrow('Ticket visibility context has an invalid effective scope');
    expect(() =>
      applyTicketVisibilityFilter(makeQueryBuilder(), { ...baseVisibility, effectiveTicketScope: 'everyone' as any }, columns)
    ).toThrow('Ticket visibility context has an invalid effective scope');
  });

  it('refuses a contact-scoped context with no contact instead of returning every ticket', () => {
    expect(() =>
      applyTicketVisibilityFilter(makeQueryBuilder(), { ...contactScoped, contactId: '' }, columns)
    ).toThrow('Contact-scoped ticket visibility requires a contact');
  });

  it('resolves a non-admin contact-scoped assignment end to end', async () => {
    const visibility = await getClientContactVisibilityContext(
      buildTrx({
        contact: { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: 'group-1', is_client_admin: false },
        group: { group_id: 'group-1', client_id: 'client-1', ticket_scope: 'contact' },
        boardIds: ['board-1'],
      }),
      'tenant-1',
      'contact-1'
    );
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(query, visibility, columns);
    expect(query.where).toHaveBeenCalledWith('t.contact_name_id', 'contact-1');
  });
});

// The package module must stay a re-export of the shared implementation: two
// copies is how the contact predicate went missing on one of them before.
describe('single implementation', () => {
  it('re-exports the shared module rather than forking it', async () => {
    const shared = await import('@alga-psa/shared/lib/tickets/clientPortalVisibility');
    const sharedServer = await import('@alga-psa/shared/lib/tickets/clientPortalVisibility.server');
    expect(applyTicketVisibilityFilter).toBe(shared.applyTicketVisibilityFilter);
    expect(getClientContactVisibilityContext).toBe(sharedServer.getClientContactVisibilityContext);
  });
});

describe('row locking', () => {
  function buildLockingTrx() {
    const locked: string[] = [];
    const rows: Record<string, unknown> = {
      contacts: { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: 'group-1', is_client_admin: false },
      client_portal_visibility_groups: { group_id: 'group-1', client_id: 'client-1', ticket_scope: 'contact' },
    };
    const trx = ((table: string) => {
      if (table === 'boards') {
        return { select: vi.fn().mockResolvedValue([]) };
      }
      const builder: any = {
        modify(callback: (query: any) => void) { callback(this); return this; },
        forShare() { locked.push(table); return this; },
        join: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(rows[table]),
        select: vi.fn().mockResolvedValue([{ board_id: 'board-1' }]),
      };
      builder.where = vi.fn().mockReturnValue(builder);
      return builder;
    }) as any;
    return { trx, locked };
  }

  it('takes a share lock on the assignment rows when asked', async () => {
    const { trx, locked } = buildLockingTrx();
    await getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1', { lock: true });
    expect(locked).toEqual([
      'contacts',
      'client_portal_visibility_groups',
      'client_portal_visibility_group_boards as cvgb',
    ]);
  });

  it('takes no lock by default', async () => {
    const { trx, locked } = buildLockingTrx();
    await getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1');
    expect(locked).toEqual([]);
  });

  it('still resolves the contact scope while locking', async () => {
    const { trx } = buildLockingTrx();
    await expect(
      getClientContactVisibilityContext(trx, 'tenant-1', 'contact-1', { lock: true })
    ).resolves.toMatchObject({ ticketScope: 'contact', effectiveTicketScope: 'contact', visibleBoardIds: ['board-1'] });
  });
});
