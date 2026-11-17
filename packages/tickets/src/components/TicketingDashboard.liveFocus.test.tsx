/* @vitest-environment jsdom */

/**
 * Live-change banner and focus overlay on the real dashboard (T007 banner half, T010).
 *
 * Same harness as TicketingDashboard.printLabels.test.tsx: children, actions and pickers are inert stubs.
 * The live-change hook is replaced so the test can push events, and the actions module records the
 * select-all-matching request.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TicketingDashboard from './TicketingDashboard';
import { TicketsRouteProvider } from './TicketsRouteProvider';

const h = vi.hoisted(() => {
  const NullComponent = () => null;
  const autoMock = (overrides: Record<string, unknown> = {}) => () =>
    new Proxy(overrides, {
      has: () => true,
      get(target, key) {
        if (typeof key !== 'string') return undefined;
        if (key === 'then') return undefined;
        if (key in target) return target[key];
        if (key === '__esModule') return true;
        if (key === 'default' || /^[A-Z]/.test(key)) return NullComponent;
        return async () => undefined;
      },
    });
  const live = { onChange: null as null | ((event: any) => void) };
  const getAllMatchingTicketIds = vi.fn(async (_filters: unknown) => ['t-0', 't-1', 'x-1', 'x-2', 'x-3']);
  return { autoMock, NullComponent, live, getAllMatchingTicketIds };
});

vi.mock('@alga-psa/ui/components', () => ({
  LabelPrintDialog: () => null,
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/tickets',
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: any) => {
    let text = String(typeof options === 'string' ? options : options?.defaultValue ?? key);
    for (const [k, v] of Object.entries(typeof options === 'object' && options ? options : {})) {
      text = text.replace(`{{${k}}}`, String(v));
    }
    return text;
  };
  const value = { t };
  const formatters = {
    formatDate: () => '', formatNumber: () => '', formatCurrency: () => '', formatRelativeTime: () => '',
    locale: 'en', dateFormat: 'MM/dd/yyyy',
  };
  return { useTranslation: () => value, useFormatters: () => formatters };
});
// BulkTicketActionBar uses react-i18next directly.
vi.mock('react-i18next', () => {
  const value = {
    t: (key: string, def?: any, opts?: Record<string, unknown>) => {
      let text = typeof def === 'string' ? def : String(def?.defaultValue ?? key);
      for (const [k, v] of Object.entries(opts ?? {})) text = text.replace(`{{${k}}}`, String(v));
      return text;
    },
  };
  return { useTranslation: () => value };
});
vi.mock('@alga-psa/ui', () => {
  const drawer = { openDrawer: () => undefined, closeDrawer: () => undefined, replaceDrawer: () => undefined };
  return { useDrawer: () => drawer };
});
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  ShortcutActiveRegion: ({ children }: any) => <div>{children}</div>,
  usePageCreateShortcut: () => undefined,
  useCatalogShortcut: () => undefined,
  useShortcutScope: () => undefined,
}));
vi.mock('@alga-psa/tags/hooks', () => ({ useTagPermissions: () => undefined }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ id }),
  withUIReflectionId: (c: unknown) => c,
}));
vi.mock('@alga-psa/ui/hooks', async () => {
  const actual = await vi.importActual<any>('@alga-psa/ui/hooks/useRangeSelection');
  // The list reads the seat capability to hold its seat column and views shut; this suite is the closed case.
  return { useRangeSelection: actual.useRangeSelection, useCapability: () => ({ enabled: false, admitted: false, resolved: true }) };
});

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, onChange, onClick, indeterminate: _i, skipRegistration: _s, containerClassName: _c, ...props }: any) => (
    <input type="checkbox" id={id} checked={Boolean(checked)} onClick={onClick} onChange={onChange ?? (() => undefined)} {...props} />
  ),
}));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));
// Render only the selection column of each row.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data = [], columns = [], onVisibleRowsChange }: any) => {
    React.useEffect(() => { onVisibleRowsChange?.(data); }, [data, onVisibleRowsChange]);
    const selection = columns.find((c: any) => c.dataIndex === 'selection');
    return (
      <table id={id} data-columns={columns.map((c: any) => c.dataIndex).join(',')}>
        <tbody>
          {data.map((record: any, i: number) => (
            <tr key={record.ticket_id ?? i}>
              <td>{selection?.render ? selection.render(undefined, record, i) : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
}));
vi.mock('@alga-psa/ui/components/BulkActionBar', () => ({
  BulkActionBar: ({ actions = [], idPrefix }: any) => (
    <div>
      {actions.map((a: any) => (
        <button key={a.id} id={`${idPrefix}-${a.id}-button`} disabled={a.disabled} onClick={a.onClick}>{a.label}</button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/SmartSearchResults', h.autoMock());
vi.mock('@alga-psa/ui/components/CustomSelect', h.autoMock());
vi.mock('@alga-psa/ui/components/tickets/PrioritySelect', h.autoMock());
vi.mock('@alga-psa/ui/components/Input', h.autoMock());
vi.mock('@alga-psa/ui/components/Switch', h.autoMock());
vi.mock('@alga-psa/ui/components/Label', h.autoMock());
vi.mock('@alga-psa/ui/components/ClientPicker', h.autoMock());
vi.mock('@alga-psa/ui/components/tags/TagFilter', h.autoMock());
vi.mock('@alga-psa/ui/components/tags', h.autoMock());
vi.mock('@alga-psa/ui/components/PrintableTable', h.autoMock());
vi.mock('@alga-psa/ui/components/ShareActionsMenu', h.autoMock());
vi.mock('@alga-psa/ui/components/Dialog', h.autoMock());
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Spinner', h.autoMock());
vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', h.autoMock());
vi.mock('@alga-psa/ui/components/DatePicker', h.autoMock());
vi.mock('@alga-psa/teams/actions', h.autoMock());
vi.mock('@alga-psa/user-composition/actions', h.autoMock());
vi.mock('../actions/ticketActions', h.autoMock());
vi.mock('../actions/board-actions/boardTicketStatusActions', h.autoMock());
vi.mock('../actions/board-actions/boardActions', h.autoMock());
vi.mock('../actions/optimizedTicketActions', h.autoMock({ getAllMatchingTicketIds: (filters: unknown) => h.getAllMatchingTicketIds(filters), getTicketBoardIds: async () => [] }));
vi.mock('../hooks/useTicketListChanges', () => ({
  useTicketListChanges: (_tenant: unknown, onChange: (event: any) => void) => { h.live.onChange = onChange; },
}));
vi.mock('../actions/ticketDisplaySettings', h.autoMock());
vi.mock('../actions/clientLookupActions', h.autoMock());
vi.mock('./BulkBundleDialog', h.autoMock());
vi.mock('./CategoryPicker', h.autoMock());
vi.mock('./BoardFilterPicker', h.autoMock());
vi.mock('./BoardTabStrip', h.autoMock());
vi.mock('./BoardHeader', h.autoMock());
vi.mock('./TicketViewMenu', h.autoMock());
vi.mock('./QuickAddCategory', h.autoMock());
vi.mock('./ticket/TicketNotificationSuppressionControl', h.autoMock());
vi.mock('@alga-psa/ui/components/PrintOptionsDialog', () => {
  const sel = {
    selectedColumnKeys: [], selectedColumns: [], setSelectedColumnKeys: () => undefined, resetSelectedColumnKeys: () => undefined,
  };
  const cols: never[] = [];
  return {
    createPrintColumnsFromColumnDefinitions: () => cols,
    PrintOptionsDialog: () => null,
    usePrintColumnSelection: () => sel,
  };
});
vi.mock('@alga-psa/ui/components/PrintButton', () => {
  const action = { triggerPrint: () => undefined, isPreparing: false };
  return { PrintButton: () => null, usePrintAction: () => action };
});
vi.mock('./templates/useTicketTemplatePermissions', () => {
  const perms = { canCreate: false, canUse: false, canManage: false };
  return { useTicketTemplatePermissions: () => perms };
});

function ticket(id: string) {
  return { ticket_id: id, ticket_number: id, title: `Ticket ${id}`, tenant: 'tenant-1' } as any;
}

const AVATARS: Record<string, string | null> = {};
const TICKET_TAGS: Record<string, never[]> = {};
const USER = { user_id: 'u1' } as any;
const FILTER_VALUES = {};
const LOADED_FILTERS = { boardId: 'board-a', boardFilterState: 'all' as const };
const T0 = Date.parse('2026-01-01T00:00:00Z');

const FULL_ROWS = [ticket('t-0'), ticket('t-1')];

function liveEvent(ticketId: string, updatedAt: string, changeKind: 'created' | 'updated' = 'created') {
  return {
    ticketId, changeKind, boardId: 'board-a', statusId: 'open', statusIsClosed: false, assigneeIds: [], searchText: 'x',
    actorUserId: 'someone-else', updatedAt, isBoardActive: true,
  };
}

function dashboard(overrides: Record<string, unknown> = {}) {
  const noop = vi.fn();
  return (
    <TicketsRouteProvider>
      <TicketingDashboard
        initialTickets={FULL_ROWS}
        loadedAt={T0}
        loadedFilters={LOADED_FILTERS}
        onRefreshListForChanges={async () => true}
        initialBoards={[]}
        initialStatuses={[]}
        initialPriorities={[]}
        initialCategories={[]}
        totalCount={2}
        currentPage={1}
        pageSize={10}
        onPageChange={noop}
        onPageSizeChange={noop}
        onFilterChange={noop}
        filterValues={FILTER_VALUES}
        isLoadingMore={false}
        onSortChange={noop}
        user={USER}
        initialAgentAvatarUrls={AVATARS}
        initialTeamAvatarUrls={AVATARS}
        initialTicketTags={TICKET_TAGS}
        {...overrides}
      />
    </TicketsRouteProvider>
  );
}

const push = (event: ReturnType<typeof liveEvent>) => act(() => { h.live.onChange!(event); });
const byId = (id: string) => document.getElementById(id);
const text = (id: string) => byId(id)?.textContent?.trim();

describe('live-change banner controls', () => {
  afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); h.getAllMatchingTicketIds.mockClear(); });

  it('T007: shows separate new / updated / refresh controls, each only when it has something to do', async () => {
    render(dashboard());
    expect(byId('ticket-list-changes')).toBeNull();

    await push(liveEvent('n1', '2026-01-01T00:01:00Z'));
    expect(text('ticket-list-changes-new')).toBe('1 new ticket');
    expect(byId('ticket-list-changes-updated')).toBeNull();
    expect(text('ticket-list-changes-refresh')).toBe('Refresh list');

    await push(liveEvent('n2', '2026-01-01T00:01:10Z'));
    await push(liveEvent('t-0', '2026-01-01T00:01:20Z', 'updated'));
    expect(text('ticket-list-changes-new')).toBe('2 new tickets');
    expect(text('ticket-list-changes-updated')).toBe('1 ticket updated');
    expect(byId('refresh-ticket-list-changes')).toBeNull();
  });

  it('T007: "N new" asks the container to focus the new ids; "Refresh list" asks for the full list', async () => {
    const onFocusOnChanges = vi.fn(async () => true);
    const onRefreshListForChanges = vi.fn(async () => true);
    render(dashboard({ onFocusOnChanges, onRefreshListForChanges }));
    await push(liveEvent('n1', '2026-01-01T00:01:00Z'));
    await push(liveEvent('n2', '2026-01-01T00:01:10Z'));
    await push(liveEvent('t-0', '2026-01-01T00:01:20Z', 'updated'));

    await userEvent.click(byId('ticket-list-changes-new')!);
    expect(onFocusOnChanges).toHaveBeenCalledWith('new', ['n1', 'n2'], false);
    await userEvent.click(byId('ticket-list-changes-updated')!);
    expect(onFocusOnChanges).toHaveBeenLastCalledWith('updated', ['t-0'], false);
    expect(onRefreshListForChanges).not.toHaveBeenCalled();

    await userEvent.click(byId('ticket-list-changes-refresh')!);
    expect(onRefreshListForChanges).toHaveBeenCalledTimes(1);
  });

  it('T007: once focused, only the clicked kind is acknowledged, the notice appears, and later events still count against the full list', async () => {
    const { rerender } = render(dashboard());
    await push(liveEvent('n1', '2026-01-01T00:01:00Z'));
    await push(liveEvent('n2', '2026-01-01T00:01:10Z'));
    await push(liveEvent('t-0', '2026-01-01T00:01:20Z', 'updated'));

    // The container answers the click with the focused rows, a later loadedAt and the overlay.
    const focus = { kind: 'new' as const, ticketIds: ['n1', 'n2'], capped: false };
    rerender(dashboard({
      initialTickets: [ticket('n1'), ticket('n2')], loadedAt: Date.parse('2026-01-01T00:02:00Z'),
      loadedFilters: { statusId: 'all', where: { join: 'and', clauses: [{ path: 'ticket_id', operator: 'in', value: ['n1', 'n2'] }] } },
      totalCount: 2, focus,
    }));
    expect(text('ticket-list-focus-notice')).toContain('Showing 2 new tickets');
    expect(text('ticket-list-focus-show-all')).toBe('Show all tickets');
    expect(byId('ticket-list-changes-new')).toBeNull();
    expect(text('ticket-list-changes-updated')).toBe('1 ticket updated');

    // Counting keeps running against the full list (t-0 is on it; n3 is not).
    await push(liveEvent('n3', '2026-01-01T00:03:00Z'));
    await push(liveEvent('t-1', '2026-01-01T00:03:10Z', 'updated'));
    expect(text('ticket-list-changes-new')).toBe('1 new ticket');
    expect(text('ticket-list-changes-updated')).toBe('2 tickets updated');
  });

  it('T007: the capped notice wording is used when the focus is capped', () => {
    render(dashboard({ focus: { kind: 'updated', ticketIds: ['t-0'], capped: true }, totalCount: 1 }));
    expect(text('ticket-list-focus-notice')).toContain('Showing the first 1 updated tickets (more are not shown)');
  });

  it('T010: select-all-matching while focused requests ids with the focused filters', async () => {
    const focus = { kind: 'new' as const, ticketIds: ['t-0', 't-1', 'x-1', 'x-2', 'x-3'], capped: false };
    render(dashboard({
      focus, totalCount: 5, filterValues: { statusId: 'closed-status', boardIds: ['board-a'], searchQuery: 'printer' },
      sortBy: 'title', sortDirection: 'asc',
    }));
    await userEvent.click(await pick('ticketing-dashboard-select-t-0'));
    await userEvent.click(await pick('ticketing-dashboard-select-t-1'));
    await userEvent.click(await screen.findByText('Select all 5 tickets matching your filters'));

    await waitFor(() => expect(h.getAllMatchingTicketIds).toHaveBeenCalledTimes(1));
    const request = h.getAllMatchingTicketIds.mock.calls[0][0] as any;
    expect(request.where).toEqual({ join: 'and', clauses: [{ path: 'ticket_id', operator: 'in', value: focus.ticketIds }] });
    expect(request.boardFilterState).toBe('all');
    expect(request.bundleView).toBe('individual');
    expect(request.boardIds).toBeUndefined();
    expect(request.searchQuery).toBe('');
    expect(request.sortBy).toBe('title');
  });

  it('T010: without focus, select-all-matching uses the list filters', async () => {
    render(dashboard({ totalCount: 5, filterValues: { boardIds: ['board-a'] } }));
    await userEvent.click(await pick('ticketing-dashboard-select-t-0'));
    await userEvent.click(await pick('ticketing-dashboard-select-t-1'));
    await userEvent.click(await screen.findByText('Select all 5 tickets matching your filters'));
    await waitFor(() => expect(h.getAllMatchingTicketIds).toHaveBeenCalledTimes(1));
    const request = h.getAllMatchingTicketIds.mock.calls[0][0] as any;
    expect(request.where).toBeUndefined();
    expect(request.boardIds).toEqual(['board-a']);
  });
});

const pick = (id: string) =>
  waitFor(() => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing ${id}`);
    return el;
  });
