/* @vitest-environment jsdom */

/**
 * Selecting tickets in the dashboard list and clicking the bulk "Print labels" action opens
 * LabelPrintDialog (ticket-work-tag) for exactly the selected ticket ids.
 *
 * The dashboard is a ~3k-line container: children, actions, pickers and the route-state context
 * are inert stubs; the real selection hook, BulkTicketActionBar and BulkActionBar run.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  return { autoMock, NullComponent };
});

vi.mock('@alga-psa/ui/components', () => ({
  LabelPrintDialog: (props: any) => (
    <div data-testid="label-dialog" data-label-class={props.labelClass} data-ids={JSON.stringify(props.ids)} />
  ),
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
  return { useRangeSelection: actual.useRangeSelection };
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
  DataTable: ({ id, data = [], columns = [] }: any) => {
    const selection = columns.find((c: any) => c.dataIndex === 'selection');
    return (
      <table id={id}>
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
vi.mock('@alga-psa/ui/components/Alert', h.autoMock());
vi.mock('@alga-psa/ui/components/Spinner', h.autoMock());
vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', h.autoMock());
vi.mock('@alga-psa/ui/components/DatePicker', h.autoMock());
vi.mock('@alga-psa/teams/actions', h.autoMock());
vi.mock('@alga-psa/user-composition/actions', h.autoMock());
vi.mock('../actions/ticketActions', h.autoMock());
vi.mock('../actions/board-actions/boardTicketStatusActions', h.autoMock());
vi.mock('../actions/board-actions/boardActions', h.autoMock());
vi.mock('../actions/optimizedTicketActions', h.autoMock());
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

function ticket(i: number) {
  return { ticket_id: `t-${i}`, ticket_number: `T-${i}`, title: `Ticket ${i}`, tenant: 'tenant-1' } as any;
}

// Stable references: the dashboard's `= {}` prop defaults are new objects each render and feed effects that
// call setState, so omitting these props would re-render forever.
const AVATARS: Record<string, string | null> = {};
const TICKET_TAGS: Record<string, never[]> = {};
const USER = { user_id: 'u1' } as any;

function renderDashboard(count: number) {
  const tickets = Array.from({ length: count }, (_, i) => ticket(i));
  const noop = vi.fn();
  render(
    <TicketsRouteProvider>
    <TicketingDashboard
      initialTickets={tickets}
      initialBoards={[]}
      initialStatuses={[]}
      initialPriorities={[]}
      initialCategories={[]}
      initialClients={[]}
      totalCount={count}
      currentPage={1}
      pageSize={count}
      onPageChange={noop}
      onPageSizeChange={noop}
      onFilterChange={noop}
      filterValues={{}}
      isLoadingMore={false}
      onSortChange={noop}
      user={USER}
      initialAgentAvatarUrls={AVATARS}
      initialTeamAvatarUrls={AVATARS}
      initialTicketTags={TICKET_TAGS}
    />
    </TicketsRouteProvider>,
  );
}

const pick = (id: string) =>
  waitFor(() => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing ${id}`);
    return el;
  });

describe('TicketingDashboard bulk print labels', () => {
  afterEach(cleanup);

  it('opens the work-tag dialog for exactly the selected ticket ids', async () => {
    renderDashboard(3);
    await userEvent.click(await pick('ticketing-dashboard-select-t-0'));
    await userEvent.click(await pick('ticketing-dashboard-select-t-2'));
    expect(screen.queryByTestId('label-dialog')).toBeNull();

    await userEvent.click(await pick('ticketing-dashboard-bulk-print-labels-button'));

    const dialog = screen.getByTestId('label-dialog');
    expect(dialog.getAttribute('data-label-class')).toBe('ticket-work-tag');
    expect(JSON.parse(dialog.getAttribute('data-ids')!).sort()).toEqual(['t-0', 't-2']);
  });
});
