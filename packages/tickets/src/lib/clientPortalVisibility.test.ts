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
    orWhereIn: vi.fn().mockReturnThis(),
    orWhereNull: vi.fn().mockReturnThis(),
  } as any;
}

/** Runs the nested builder the profile-grant branch passes to `where()`. */
function capturedGroupedPredicate(query: any) {
  const grouped = query.where.mock.calls.find(
    ([first]: any[]) => typeof first === 'function'
  );
  if (!grouped) return null;
  const inner = makeQueryBuilder();
  grouped[0](inner);
  return inner;
}

function buildTrx(params: {
  contact?: { contact_name_id: string; client_id: string | null; portal_visibility_group_id: string | null; is_client_admin?: boolean };
  group?: { group_id: string; client_id: string; ticket_scope?: 'client' | 'contact' };
  boardIds?: string[];
  boards?: Array<{ board_id: string; client_portal_visible: boolean }>;
  profiles?: Array<{ billing_profile_id: string; is_default: boolean }>;
  grants?: Array<{ billing_profile_id: string }>;
}) {
  return ((table: string) => {
    if (table === 'boards') {
      return {
        select: vi.fn().mockResolvedValue(params.boards ?? []),
      };
    }

    if (table === 'client_billing_profiles') {
      return {
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue(params.profiles ?? []),
        }),
      };
    }

    if (table === 'billing_profile_contacts') {
      return {
        where: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue(params.grants ?? []),
        }),
      };
    }

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
          first: vi.fn().mockResolvedValue(params.group && { ticket_scope: 'client', ...params.group }),
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
      grantedTicketProfileIds: [],
      defaultBillingProfileId: null,
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
      grantedTicketProfileIds: [],
      defaultBillingProfileId: null,
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
      grantedTicketProfileIds: [],
      defaultBillingProfileId: null,
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

  it('TM005: loads only granted profiles that belong to the contact\'s own client', async () => {
    const result = await getClientContactVisibilityContext(buildTrx({
      contact: { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: 'g' },
      group: { group_id: 'g', client_id: 'client-1', ticket_scope: 'contact' },
      boardIds: ['board-1'],
      profiles: [
        { billing_profile_id: 'profile-default', is_default: true },
        { billing_profile_id: 'profile-north', is_default: false },
      ],
      // 'profile-elsewhere' is a leftover association pointing at another
      // client's profile; it must not widen what this contact can read.
      grants: [{ billing_profile_id: 'profile-north' }, { billing_profile_id: 'profile-elsewhere' }],
    }), 'tenant-1', 'contact-1');

    expect(result).toMatchObject({
      grantedTicketProfileIds: ['profile-north'],
      defaultBillingProfileId: 'profile-default',
    });
  });

  it('does not query grants for a client-scoped contact', async () => {
    // buildTrx throws on tables it is not asked about, so reaching the grant
    // tables here would fail the test outright.
    await expect(getClientContactVisibilityContext(buildTrx({
      contact: { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: 'g' },
      group: { group_id: 'g', client_id: 'client-1', ticket_scope: 'client' },
      boardIds: ['board-1'],
    }), 'tenant-1', 'contact-1')).resolves.toMatchObject({ grantedTicketProfileIds: [] });
  });

  it('fails closed when the group is missing or its scope is invalid', async () => {
    const contact = { contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: 'g' };
    await expect(getClientContactVisibilityContext(buildTrx({ contact }), 'tenant-1', 'contact-1')).rejects.toThrow('missing or inaccessible');
    await expect(getClientContactVisibilityContext(buildTrx({ contact, group: { group_id: 'g', client_id: 'client-1', ticket_scope: 'bad' as any } }), 'tenant-1', 'contact-1')).rejects.toThrow('invalid ticket scope');
  });
});

describe('billing-profile ticket grants', () => {
  const contactScope = {
    ticketScope: 'contact' as const,
    effectiveTicketScope: 'contact' as const,
    isClientAdmin: false,
    contactId: 'contact-1',
    clientId: 'client-1',
    visibilityGroupId: 'g',
    visibleBoardIds: null,
  };
  const profileColumns = { ...columns, billingProfileColumn: 't.billing_profile_id' };

  it('TM001: with no grants the predicate is exactly today\'s own-tickets rule', () => {
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(
      query,
      { ...contactScope, grantedTicketProfileIds: [], defaultBillingProfileId: 'profile-default' },
      profileColumns
    );
    expect(query.where).toHaveBeenCalledWith('t.contact_name_id', 'contact-1');
    expect(capturedGroupedPredicate(query)).toBeNull();
  });

  it('TM002: a granted profile widens to own tickets OR that profile', () => {
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(
      query,
      {
        ...contactScope,
        grantedTicketProfileIds: ['profile-north'],
        defaultBillingProfileId: 'profile-default',
      },
      profileColumns
    );

    const inner = capturedGroupedPredicate(query);
    expect(inner.where).toHaveBeenCalledWith('t.contact_name_id', 'contact-1');
    expect(inner.orWhereIn).toHaveBeenCalledWith('t.billing_profile_id', ['profile-north']);
    // The default was not granted, so unattributed tickets stay hidden.
    expect(inner.orWhereNull).not.toHaveBeenCalled();
  });

  it('TM002: granting the client default also reveals unattributed tickets', () => {
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(
      query,
      {
        ...contactScope,
        grantedTicketProfileIds: ['profile-default'],
        defaultBillingProfileId: 'profile-default',
      },
      profileColumns
    );

    const inner = capturedGroupedPredicate(query);
    expect(inner.orWhereIn).toHaveBeenCalledWith('t.billing_profile_id', ['profile-default']);
    expect(inner.orWhereNull).toHaveBeenCalledWith('t.billing_profile_id');
  });

  it('TM003: client scope and the admin override ignore grants entirely', () => {
    for (const visibility of [
      { ...contactScope, ticketScope: 'client' as const, effectiveTicketScope: 'client' as const },
      { ...contactScope, isClientAdmin: true, effectiveTicketScope: 'client' as const },
    ]) {
      const query = makeQueryBuilder();
      applyTicketVisibilityFilter(
        query,
        { ...visibility, grantedTicketProfileIds: ['profile-north'], defaultBillingProfileId: 'profile-default' },
        profileColumns
      );
      expect(query.where).not.toHaveBeenCalled();
      expect(query.whereIn).not.toHaveBeenCalled();
    }
  });

  it('TM004: a call site that omits the profile column narrows instead of widening', () => {
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(
      query,
      {
        ...contactScope,
        grantedTicketProfileIds: ['profile-north'],
        defaultBillingProfileId: 'profile-default',
      },
      columns
    );
    expect(query.where).toHaveBeenCalledWith('t.contact_name_id', 'contact-1');
    expect(capturedGroupedPredicate(query)).toBeNull();
  });

  it('keeps the board restriction alongside a profile grant', () => {
    const query = makeQueryBuilder();
    applyTicketVisibilityFilter(
      query,
      {
        ...contactScope,
        visibleBoardIds: ['board-1'],
        grantedTicketProfileIds: ['profile-north'],
        defaultBillingProfileId: 'profile-default',
      },
      profileColumns
    );
    expect(query.whereIn).toHaveBeenCalledWith('t.board_id', ['board-1']);
    expect(capturedGroupedPredicate(query)).not.toBeNull();
  });
});
