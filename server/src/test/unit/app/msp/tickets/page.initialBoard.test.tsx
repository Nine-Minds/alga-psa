import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

/**
 * The remembered board tab is resolved here, on the server, before first paint.
 *
 * It used to be a client effect that fired once the preference resolved: a
 * second list fetch, a board that visibly jumped a beat after the list had
 * rendered, and — the reported bug — a history.replaceState late enough to land
 * after a ticket click and bounce the user back to the list on a different
 * board. The precedence rules it carried have to survive the move:
 *
 *   URL board  >  remembered board  >  All tickets
 *   URL filter intent  >  the board's stored default view
 *
 * plus "a stored board that no longer exists is ignored", which is what stops a
 * deleted board rendering a tab that cannot be there.
 */

const BOARD_ID = 'b1111111-1111-4111-8111-111111111111';

const getCurrentUserMock = vi.fn();
const getCurrentUserPermissionsMock = vi.fn();
const getUserPreferenceMock = vi.fn();
const getCurrentTenantProductMock = vi.fn();
const getConsolidatedTicketListDataMock = vi.fn();
const getTicketingDisplaySettingsMock = vi.fn();
const getTeamsMock = vi.fn();
const findBoardByIdMock = vi.fn();

function MspTicketsPageClientMock() {
  return null;
}

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
  getCurrentUserPermissions: getCurrentUserPermissionsMock,
  getUserPreference: getUserPreferenceMock,
}));

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: getCurrentTenantProductMock,
}));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getConsolidatedTicketListData: getConsolidatedTicketListDataMock,
}));

vi.mock('@alga-psa/tickets/actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: getTicketingDisplaySettingsMock,
}));

vi.mock('@alga-psa/tickets/actions/board-actions/boardActions', () => ({
  findBoardById: findBoardByIdMock,
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: getTeamsMock,
  isTeamActionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'error' in value),
}));

vi.mock('@alga-psa/msp-composition/tickets/MspTicketsPageClient', () => ({
  default: MspTicketsPageClientMock,
}));

const { default: TicketsPage } = await import('server/src/app/msp/tickets/page');

const renderProps = async (search: Record<string, string>) => {
  const result = await TicketsPage({ searchParams: Promise.resolve(search) });
  const pageContainer = result as React.ReactElement<{ children: React.ReactElement }>;
  return pageContainer.props.children.props as Record<string, unknown>;
};

const initialFiltersOf = (props: Record<string, unknown>) =>
  props.initialFilters as Record<string, unknown>;

describe('MSP tickets page initial board resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
    getCurrentUserPermissionsMock.mockResolvedValue(['ticket:update']);
    getCurrentTenantProductMock.mockResolvedValue('psa');
    getUserPreferenceMock.mockImplementation(async (_userId: string, setting: string) =>
      setting === 'tickets_last_active_board' ? BOARD_ID : null,
    );
    findBoardByIdMock.mockResolvedValue({ board_id: BOARD_ID, board_name: 'Support' });
    getConsolidatedTicketListDataMock.mockResolvedValue({
      tickets: [],
      totalCount: 0,
      options: {
        boardOptions: [],
        statusOptions: [],
        priorityOptions: [],
        categories: [],
        clients: [],
        users: [],
        tags: [],
      },
      metadata: { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} },
    });
    getTicketingDisplaySettingsMock.mockResolvedValue({ responseStateTrackingEnabled: true });
    getTeamsMock.mockResolvedValue([]);
  });

  it('seeds the remembered board into the first paint and the first fetch', async () => {
    const props = await renderProps({});

    expect(findBoardByIdMock).toHaveBeenCalledWith(BOARD_ID);
    expect(initialFiltersOf(props).boardIds).toEqual([BOARD_ID]);
    // The one list fetch this page makes is already scoped to the board: there
    // is no second, client-side fetch chasing it any more.
    expect(getConsolidatedTicketListDataMock.mock.calls[0][0]).toMatchObject({ boardIds: [BOARD_ID] });
  });

  it('lets a URL that names a board win outright', async () => {
    const props = await renderProps({ boardId: 'c2222222-2222-4222-8222-222222222222' });

    expect(getUserPreferenceMock).not.toHaveBeenCalledWith(expect.anything(), 'tickets_last_active_board');
    expect(findBoardByIdMock).not.toHaveBeenCalled();
    expect(initialFiltersOf(props).boardId).toBe('c2222222-2222-4222-8222-222222222222');
    expect(initialFiltersOf(props).boardIds).toBeUndefined();
  });

  it('ignores a remembered board that no longer exists', async () => {
    findBoardByIdMock.mockResolvedValue(undefined);

    const props = await renderProps({});

    expect(initialFiltersOf(props).boardIds).toBeUndefined();
  });

  it('ignores a remembered board the action refuses to return', async () => {
    findBoardByIdMock.mockResolvedValue({ permissionError: 'Permission denied' });

    const props = await renderProps({});

    expect(initialFiltersOf(props).boardIds).toBeUndefined();
  });

  it('ignores an empty preference without looking up a board', async () => {
    getUserPreferenceMock.mockResolvedValue('   ');

    const props = await renderProps({});

    expect(findBoardByIdMock).not.toHaveBeenCalled();
    expect(initialFiltersOf(props).boardIds).toBeUndefined();
  });

  it('applies the board default view when the URL has no filter opinion', async () => {
    findBoardByIdMock.mockResolvedValue({
      board_id: BOARD_ID,
      board_name: 'Support',
      list_view_settings: {
        filters: { priorityId: 'priority-high', sortBy: 'due_date', sortDirection: 'asc' },
      },
    });

    const props = await renderProps({});
    const filters = initialFiltersOf(props);

    expect(filters.boardIds).toEqual([BOARD_ID]);
    expect(filters.priorityId).toBe('priority-high');
    expect(filters.sortBy).toBe('due_date');
    expect(filters.sortDirection).toBe('asc');
  });

  it('falls through to the tenant view when the board stores none', async () => {
    getTicketingDisplaySettingsMock.mockResolvedValue({
      responseStateTrackingEnabled: true,
      list: { filters: { priorityId: 'tenant-priority' } },
    });

    const props = await renderProps({});

    expect(initialFiltersOf(props).priorityId).toBe('tenant-priority');
  });

  it('lets URL filter intent outrank the board default view', async () => {
    findBoardByIdMock.mockResolvedValue({
      board_id: BOARD_ID,
      board_name: 'Support',
      list_view_settings: { filters: { priorityId: 'priority-high' } },
    });

    const props = await renderProps({ priorityId: 'priority-from-link' });
    const filters = initialFiltersOf(props);

    // The board still selects the tab — `?boardId=` says which board, not what
    // to show on it — but the link's filters are the ones that apply.
    expect(filters.boardIds).toEqual([BOARD_ID]);
    expect(filters.priorityId).toBe('priority-from-link');
  });

  it('never lets a stored view scope the board somewhere else', async () => {
    findBoardByIdMock.mockResolvedValue({
      board_id: BOARD_ID,
      board_name: 'Support',
      list_view_settings: {
        filters: { boardIds: ['d3333333-3333-4333-8333-333333333333'], priorityId: 'priority-high' },
      },
    });

    const props = await renderProps({});

    expect(initialFiltersOf(props).boardIds).toEqual([BOARD_ID]);
  });

  it('drops an SLA filter from a stored view on tenants without SLA', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');
    findBoardByIdMock.mockResolvedValue({
      board_id: BOARD_ID,
      board_name: 'Support',
      list_view_settings: { filters: { slaStatusFilter: 'breached' } },
    });

    const props = await renderProps({});

    expect(initialFiltersOf(props).slaStatusFilter).toBeUndefined();
  });
});
