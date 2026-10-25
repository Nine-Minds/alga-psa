/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QualifiedTicketList from '../../../components/co-managed/QualifiedTicketList';

/**
 * Ticket-list T007 / T010 / T012 / T015, re-pointed at the component that is
 * actually reachable.
 *
 * These four rows were covered only by `coManagedTicketQueue.test.tsx` and
 * `coManagedTicketBulkHandback.test.tsx`, which drive `CoManagedTicketQueue`
 * and `CoManagedTicketBulkHandback`. Those two components are the duplicates
 * F028/F039 exist to retire, and they are already ORPHANED: nothing renders
 * `CoManagedTicketQueue` any more — `/msp/co-managed/tickets` goes through
 * `CoManagedTicketQueueLegacyAdapter`, and `CoManagedTicketBulkHandback` is
 * reachable only from `CoManagedTicketQueue`. So the only coverage those rows
 * had was pointed at code no user can execute, and deleting the duplicates
 * would have deleted the coverage with them.
 *
 * This file re-establishes the same assertions against `QualifiedTicketList`,
 * the live body behind `/msp/tickets` and the client-record slot. It is a
 * prerequisite for the F028/F038/F039 consolidation, not a duplicate of it.
 *
 * `DataTable` is substituted with a faithful stand-in that still invokes every
 * column's `render` and exposes the page/sort callbacks, so the selection
 * column, the qualified links and the sort/pagination contract are all really
 * exercised rather than assumed.
 */

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  export: vi.fn(),
  submit: vi.fn(),
  push: vi.fn(),
  clients: vi.fn(),
}));

vi.mock('../../../lib/actions/coManagedTicketQueueActions', () => ({
  getCoManagedTicketQueueAction: mocks.load,
  exportCoManagedTicketQueueAction: mocks.export,
  bulkHandBackCoManagedTicketsAction: mocks.submit,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock('@alga-psa/clients/actions', () => ({ getAllClients: mocks.clients }));
// Share/View are dropdowns; flatten them so the actions they hold are reachable without a portal.
vi.mock('@alga-psa/ui/components/ShareActionsMenu', () => ({
  ShareActionsMenu: ({ id, actions, disabled }: any) => (
    <div id={id} data-disabled={disabled ? 'true' : 'false'}>
      {actions.map((action: any) => (
        <button key={action.id} type="button" onClick={action.onSelect} disabled={action.disabled}>{action.label}</button>
      ))}
    </div>
  ),
}));
vi.mock('../../../components/co-managed/CoManagedTicketListViewMenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../components/co-managed/CoManagedTicketListViewMenu')>()),
  default: ({ id }: any) => <div id={id} data-testid="view-menu" />,
}));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, vars?: any) => (vars && typeof vars === 'object' ? `${key}:${JSON.stringify(vars)}` : key) }),
  useFormatters: () => ({ formatDate: () => 'Formatted date' }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  // Like the real control, a select with no visible label is named by its placeholder (the native toolbar has no labels).
  default: ({ id, label, placeholder, value, disabled, options, onValueChange }: any) => (
    <select id={id} aria-label={label ?? placeholder} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, indeterminate, onChange }: any) => (
    <input type="checkbox" id={id} aria-label={id} checked={Boolean(checked)}
      data-indeterminate={indeterminate ? 'true' : 'false'} onChange={onChange} />
  ),
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ id, label, ...props }: any) => <label htmlFor={id}>{label}<textarea id={id} {...props} /></label>,
}));

/**
 * Stand-in for DataTable that keeps the parts these rows are about: every
 * column's `render` really runs (so the selection checkboxes and qualified
 * links are the component's own output), and page/sort changes call back.
 */
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns, currentPage, onPageChange, onSortChange, onRowClick }: any) => (
    <div data-testid={id}>
      <div data-testid={`${id}-headers`}>
        {columns.map((column: any, index: number) => <div key={index}>{column.title}</div>)}
      </div>
      {data.map((record: any, rowIndex: number) => (
        <div key={rowIndex} data-testid={`${id}-row`} onClick={() => onRowClick?.(record)}>
          {columns.map((column: any, index: number) => (
            <div key={index}>{column.render ? column.render((record as any)[column.dataIndex], record) : null}</div>
          ))}
        </div>
      ))}
      <button type="button" onClick={() => onPageChange(currentPage + 1)}>next-page</button>
      <button type="button" onClick={() => onSortChange('title', 'asc')}>sort-title-asc</button>
    </div>
  ),
}));

const SCOPE = { kind: 'qualified', view: 'working', workspace: 'all' } as const;
const ACTOR = 'msp-tenant:user-1';

/** Two shared rows from different customer workspaces that happen to share one ticket id. */
const page = (overrides: Record<string, unknown> = {}) => ({
  page: 1,
  pageSize: 10,
  totalCount: 51,
  openCount: 50,
  closedCount: 1,
  workspaces: [{ tenant: 'alpha', name: 'Customer Alpha' }, { tenant: 'customer', name: 'Customer IT' }],
  items: [
    { tenant: 'alpha', relationshipId: 'relationship-alpha', ticketId: 'same-id', workspaceName: 'Customer Alpha',
      fields: { title: 'Alpha ticket', ticket_number: 'T-1', responsibility: 'customer', work_revision: 2 } },
    { tenant: 'customer', relationshipId: 'relationship', ticketId: 'same-id', workspaceName: 'Customer IT',
      fields: { title: 'Beta ticket', ticket_number: 'T-1', responsibility: 'msp', work_revision: 4 } },
  ],
  ...overrides,
});

const mount = (props: Record<string, unknown> = {}) =>
  render(<QualifiedTicketList scope={SCOPE} actorScope={ACTOR} {...props} />);

/** The request the component issues for the default presentation. */
const DEFAULT_REQUEST = {
  view: 'working', state: 'open', sort: 'updated', direction: 'desc', page: 1, pageSize: 10,
};

/**
 * The list's OWN reads. `TicketListScopeBar` independently probes the same
 * action for its workspace options (`state: 'all', pageSize: 1`, and crucially
 * no `sort`), so a bare `toHaveBeenLastCalledWith` would sometimes assert
 * against the scope bar's probe instead of the list's read. Filtering on the
 * presentation keys only the list sends keeps these assertions about the
 * subject.
 */
/** Filters are collapsed by default; open them to reach workspace/client/status. */
const openFilters = () => {
  const toggle = screen.getByRole('button', { name: /coManaged\.customerTickets\.filters/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
};
const listRequests = () => mocks.load.mock.calls.map(call => call[0]).filter(request => 'sort' in request);
const lastListRequest = () => listRequests().at(-1);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.resetAllMocks();
  window.sessionStorage.clear();
  // Echo the requested page back, the way a real server does: a stand-in that
  // always answers `page: 1` would make "go to the next page" untestable.
  mocks.load.mockImplementation(async (request: any) => page({ page: request?.page ?? 1 }));
  mocks.clients.mockResolvedValue([{ client_id: 'client-1', client_name: 'White Rabbit IT' }]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// --- T007: toolbar, sort, reset, pagination ------------------------------

describe('T007 — applied filters, sort and pagination reach the server', () => {
  it('issues the default qualified request for its scope', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    expect(listRequests()).toEqual([DEFAULT_REQUEST]);
  });

  it('sends the submitted search and each toolbar filter, resetting to page 1 every time', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });

    // Search applies as you type, after a pause; there is no Search button.
    expect(screen.queryByRole('button', { name: 'coManaged.queue.search' })).toBeNull();
    fireEvent.change(screen.getByLabelText('coManaged.queue.search'), { target: { value: 'literal 100%' } });
    expect(listRequests()).toHaveLength(1);
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, search: 'literal 100%' }));

    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, search: 'literal 100%', state: 'closed' }));

    // Sort is a column-header concern here; the toolbar has no sort/direction selects.
    expect(screen.queryByLabelText('coManaged.queue.sort')).toBeNull();
    expect(screen.queryByLabelText('coManaged.queue.direction')).toBeNull();
  });

  it('resets to page 1 when a filter changes, so page 3 of the old filter is never asked for', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });

    // Leave page 1 first — otherwise "resets to page 1" is trivially true.
    fireEvent.click(screen.getByRole('button', { name: 'next-page' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, page: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'next-page' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, page: 3 }));

    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, state: 'closed', page: 1 }));
  });

  it('returns every filter to its default on reset', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'all' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, state: 'all' }));

    fireEvent.click(screen.getByRole('button', { name: 'resetFilters' }));
    await waitFor(() => expect(lastListRequest()).toEqual(DEFAULT_REQUEST));
  });

  it('pages and sorts through the server, carrying the applied filters and never paging a stale filter', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });

    fireEvent.click(screen.getByRole('button', { name: 'next-page' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, page: 2 }));

    // A column sort is a new ordering, so it must go back to page 1 — asserted
    // from page 2, not from page 1 where it would hold for free.
    fireEvent.click(screen.getByRole('button', { name: 'sort-title-asc' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, sort: 'title', direction: 'asc', page: 1 }));
  });

  it('links identical ids to their own qualified routes and shows the server totals', async () => {
    mount();
    const alpha = await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    const beta = screen.getByRole('link', { name: 'T-1 · Beta ticket' });
    const alphaUrl = new URL(alpha.getAttribute('href')!, 'https://review.invalid');
    const betaUrl = new URL(beta.getAttribute('href')!, 'https://review.invalid');
    expect(alphaUrl.pathname).toBe('/msp/co-management/tickets/alpha/relationship-alpha/same-id');
    expect(betaUrl.pathname).toBe('/msp/co-management/tickets/customer/relationship/same-id');
    expect(alphaUrl.searchParams.get('returnTo')).toBe('/msp/tickets/customer?queueView=working&workspace=all');
    expect(betaUrl.searchParams.get('returnTo')).toBe(alphaUrl.searchParams.get('returnTo'));
    fireEvent.click(alpha);
    expect(mocks.push).toHaveBeenLastCalledWith(alpha.getAttribute('href'));
    // The counts come from the server response, not from the rows on screen.
    expect(screen.getByText('coManaged.queue.counts:{"count":51,"open":50,"closed":1}')).toBeInTheDocument();
  });
});

// --- T010: export lifetime ------------------------------------------------

describe('T010 — export uses the applied filters and never outlives them', () => {
  it('exports every match of the applied filters, without page bounds', async () => {
    mocks.export.mockResolvedValue({ filename: 'q.csv', csv: 'CSV', rowCount: 51 });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:q'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'all' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, state: 'all' }));

    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));
    // page/pageSize are deliberately stripped: an export is all matches.
    expect(mocks.export).toHaveBeenCalledExactlyOnceWith({
      view: 'working', state: 'all', sort: 'updated', direction: 'desc',
    });
    expect(screen.getByRole('button', { name: 'coManaged.queue.exporting' })).toBeDisabled();
  });

  it('downloads the server export under the server filename', async () => {
    mocks.export.mockResolvedValue({ filename: 'co-managed-working-tickets.csv', csv: 'CSV content', rowCount: 51 });
    const createUrl = vi.fn(() => 'blob:queue-export');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeUrl, configurable: true });
    const downloaded: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) { downloaded.push(this.download); });

    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));

    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(downloaded).toEqual(['co-managed-working-tickets.csv']);
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:queue-export'));
  });

  it('discards a download that arrives after the filters moved on', async () => {
    let resolveExport!: (value: any) => void;
    mocks.export.mockReturnValue(new Promise(resolve => { resolveExport = resolve; }));
    const createUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });

    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));

    // Leave the scope the export was requested for.
    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    await act(async () => resolveExport({ filename: 'old.csv', csv: 'Old data', rowCount: 2 }));

    // The rows on screen are no longer the rows this CSV describes.
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('drops the visible rows when export authority is lost, rather than leaving protected rows on screen', async () => {
    mocks.export.mockRejectedValue(new Error('Revoked'));
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.queue.exportError');
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.queryByText(/^coManaged\.queue\.counts:/)).toBeNull();
    // The rows must be genuinely DROPPED, not merely hidden behind the error.
    // Setting `error` alone would replace the body, so the only thing that
    // distinguishes "cleared" from "covered up" is the export control, which is
    // disabled precisely while there is no held result.
    expect(screen.getByRole('button', { name: 'coManaged.queue.export' })).toBeDisabled();
  });
});

// --- T015: stale responses and lost access --------------------------------

describe('T015 — a read that lost its race never lands', () => {
  it('discards a stale queue response that resolves after the filters changed', async () => {
    let resolveOld!: (value: any) => void;
    // Hang the LIST's first read specifically. Targeting it by request shape
    // matters: `mockReturnValueOnce` would be consumed by whichever of the list
    // and the scope bar's workspace probe happened to fire first, and when the
    // probe took it the generation guard was never exercised at all.
    mocks.load.mockImplementation(async (request: any) => {
      if (!('sort' in request)) return page();
      if (request.state === 'open') return new Promise(resolve => { resolveOld = resolve; });
      return page({ page: request.page ?? 1 });
    });
    mount();
    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });

    await act(async () => resolveOld(page({
      items: [{ tenant: 'alpha', relationshipId: 'relationship-alpha', ticketId: 'stale', workspaceName: 'Customer Alpha',
        fields: { title: 'Stale data', ticket_number: 'T-9', responsibility: 'msp', work_revision: 1 } }],
    })));

    expect(screen.queryByText('Stale data')).toBeNull();
    expect(screen.getByRole('link', { name: 'T-1 · Alpha ticket' })).toBeInTheDocument();
  });

  it('clears rows and counts when a refresh loses access', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    mocks.load.mockRejectedValue(new Error('Revoked'));
    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.queue.loadError');
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.queryByText(/^coManaged\.queue\.counts:/)).toBeNull();
  });
});

// --- T012: selection column feeds the single composer ---------------------

const BETA_BOX = /^co-managed-ticket-list-select-shared\|customer\|/;
describe('T012 — selection offers exactly the handback-eligible shared rows', () => {
  it('offers a checkbox only for MSP-held rows with a revision, never customer-held or revision-masked ones', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    // Alpha is customer-held; only Beta (MSP-held, revision-bearing) may be handed back.
    expect(screen.getByRole('checkbox', { name: 'co-managed-ticket-list-select-all' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: BETA_BOX })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^co-managed-ticket-list-select-shared\|alpha\|/ })).toBeNull();
  });

  it('offers no selection at all when nothing on the page is eligible', async () => {
    mocks.load.mockResolvedValue(page({
      items: [
        { tenant: 'alpha', relationshipId: 'relationship-alpha', ticketId: 'customer-held-2', workspaceName: 'Customer Alpha',
          fields: { title: 'Alpha ticket', ticket_number: 'T-1', responsibility: 'customer', work_revision: 2 } },
        // Shared, but the customer holds it.
        { tenant: 'customer', relationshipId: 'relationship', ticketId: 'customer-held', workspaceName: 'Customer IT',
          fields: { title: 'Customer ticket', ticket_number: 'T-2', responsibility: 'customer', work_revision: 4 } },
        // Shared and MSP-held, but the revision is masked.
        { tenant: 'customer', relationshipId: 'relationship', ticketId: 'masked', workspaceName: 'Customer IT',
          fields: { title: 'Masked ticket', ticket_number: 'T-3', responsibility: 'msp' } },
      ],
    }));
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });

  it('hands the selected eligible rows to one composer, which freezes the exact command', async () => {
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }]);
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });

    fireEvent.click(screen.getByRole('checkbox', { name: BETA_BOX }));
    fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Continue locally' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));

    await screen.findByRole('status');
    const request = mocks.submit.mock.lastCall![0];
    expect(request.note).toBe('Continue locally');
    // Exactly the one eligible row — the same-id sibling in another
    // workspace must not be swept in.
    expect(request.items).toHaveLength(1);
    expect(request.items[0].resource).toMatchObject({ kind: 'ticket', tenant: 'customer', relationshipId: 'relationship', id: 'same-id' });
    expect(request.items[0].expectedRevision).toBe(4);
  });

  it('select-all takes every eligible row and no others', async () => {
    mocks.load.mockResolvedValue(page({
      items: [
        { tenant: 'alpha', relationshipId: 'relationship-alpha', ticketId: 'held', workspaceName: 'Customer Alpha',
          fields: { title: 'Alpha ticket', ticket_number: 'T-1', responsibility: 'customer', work_revision: 2 } },
        { tenant: 'a', relationshipId: 'rel-a', ticketId: 'ticket-a', workspaceName: 'Customer A',
          fields: { title: 'A', ticket_number: 'T-2', responsibility: 'msp', work_revision: 1 } },
        { tenant: 'b', relationshipId: 'rel-b', ticketId: 'ticket-b', workspaceName: 'Customer B',
          fields: { title: 'B', ticket_number: 'T-3', responsibility: 'msp', work_revision: 5 } },
      ],
    }));
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }, { index: 1, ok: true, receipt: {} }]);
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'co-managed-ticket-list-select-all' }));
    fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Returning both' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));

    await screen.findByRole('status');
    const request = mocks.submit.mock.lastCall![0];
    expect(request.items.map((item: any) => item.resource.tenant)).toEqual(['a', 'b']);
    expect(request.items.map((item: any) => item.expectedRevision)).toEqual([1, 5]);
    // Each row gets its own operation identity, so one retry cannot replay another row.
    expect(request.items[0].operationId).not.toBe(request.items[1].operationId);
  });

  it('drops the selection when the filters change, so a handback cannot target rows that left the page', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    fireEvent.click(screen.getByRole('checkbox', { name: BETA_BOX }));
    expect(screen.getByRole('checkbox', { name: BETA_BOX })).toBeChecked();

    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, state: 'closed' }));
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });

    expect(screen.getByRole('checkbox', { name: BETA_BOX })).not.toBeChecked();
  });
});

// --- T022: the Customer Tickets toolbar and page surface -------------------

describe('T022 — Customer Tickets owns its toolbar and carries no native chrome', () => {
  it('shows its own heading, search, collapsed Filters, View and Share, and no Add Ticket or Bundled toggle', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    expect(screen.getByRole('heading', { level: 1, name: 'coManaged.customerTickets.title' })).toBeInTheDocument();
    expect(screen.getByLabelText('coManaged.queue.search')).toBeInTheDocument();
    expect(screen.getByTestId('view-menu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'coManaged.queue.export' })).toBeInTheDocument();
    // Filters are collapsed until asked for.
    expect(screen.queryByLabelText('coManaged.queue.state')).toBeNull();
    expect(screen.queryByText(/addMspTicket|Add Ticket|bundle/i)).toBeNull();
    expect(screen.queryByText('coManaged.queue.thisMsp')).toBeNull();
  });

  it('puts Share in the page header beside the title, not in the toolbar; an embedded list keeps it in the toolbar', async () => {
    const page = mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    const heading = screen.getByRole('heading', { level: 1, name: 'coManaged.customerTickets.title' });
    const headerRow = heading.closest('div.justify-between') as HTMLElement;
    expect(headerRow).toContainElement(document.getElementById('co-managed-ticket-list-share'));
    expect(document.getElementById('co-managed-ticket-list-toolbar')).not.toContainElement(document.getElementById('co-managed-ticket-list-share'));
    page.unmount();

    mount({ embedded: true, idPrefix: 'embedded-list' });
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(document.getElementById('embedded-list-toolbar')).toContainElement(document.getElementById('embedded-list-share'));
  });

  it('search runs as you type: keystrokes within the pause make one request, Enter applies at once, and Reset clears the text', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    const box = screen.getByLabelText('coManaged.queue.search') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'a' } });
    fireEvent.change(box, { target: { value: 'ab' } });
    fireEvent.change(box, { target: { value: 'abc' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, search: 'abc' }));
    // The intermediate values never reached the server.
    expect(listRequests().filter(request => 'search' in request).map(request => request.search)).toEqual(['abc']);
    // The text the field itself committed is not overwritten while the user keeps typing.
    fireEvent.change(box, { target: { value: 'abcd' } });
    expect(box.value).toBe('abcd');

    fireEvent.change(box, { target: { value: 'quick' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, search: 'quick' }));

    fireEvent.click(document.getElementById('co-managed-ticket-list-reset') as HTMLElement);
    await waitFor(() => expect(box.value).toBe(''));
    await waitFor(() => expect(lastListRequest()).toEqual(DEFAULT_REQUEST));
  });

  it('writes the typed search to the address bar with replaceState, never a history push', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    fireEvent.change(screen.getByLabelText('coManaged.queue.search'), { target: { value: 'door' } });
    await waitFor(() => expect(window.location.search).toContain('door'));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
    replace.mockRestore();
  });

  it('offers All workspaces plus the reader\'s own workspaces — never a "This MSP" option', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    openFilters();
    const workspace = screen.getByLabelText('coManaged.queue.workspace') as HTMLSelectElement;
    const values = Array.from(workspace.options).map(option => option.value);
    expect(values).toContain('all');
    expect(values).not.toContain('msp-own');
    expect(Array.from(workspace.options).map(option => option.textContent)).not.toContain('coManaged.queue.thisMsp');
  });

  it('applies a workspace filter and a client filter to the request', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.workspace'), { target: { value: 'customer' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, workspaceTenant: 'customer' }));
    await waitFor(() => expect(mocks.clients).toHaveBeenCalledWith(false));
    await screen.findByRole('option', { name: 'White Rabbit IT' });
    fireEvent.change(screen.getByLabelText('coManaged.customerTickets.client'), { target: { value: 'client-1' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, workspaceTenant: 'customer', clientId: 'client-1' }));
  });

  it('writes the newly selected workspace to the address bar, not the previous one', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const workspaceParam = () => new URLSearchParams(window.location.search).get('workspace');
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    openFilters();
    const select = screen.getByLabelText('coManaged.queue.workspace');

    fireEvent.change(select, { target: { value: 'alpha' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, workspaceTenant: 'alpha' }));
    expect(workspaceParam()).toBe('alpha');

    fireEvent.change(select, { target: { value: 'customer' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, workspaceTenant: 'customer' }));
    expect(workspaceParam()).toBe('customer');

    fireEvent.change(select, { target: { value: 'all' } });
    await waitFor(() => expect(lastListRequest()).toEqual(DEFAULT_REQUEST));
    expect(workspaceParam()).toBe('all');
    // Every write replaced the entry; nothing was pushed.
    expect(replaceState).toHaveBeenCalledTimes(3);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('writes workspace=all to the address bar when Reset runs from a tenant workspace', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    openFilters();
    fireEvent.change(screen.getByLabelText('coManaged.queue.workspace'), { target: { value: 'customer' } });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('workspace')).toBe('customer'));

    fireEvent.click(screen.getByRole('button', { name: 'resetFilters' }));
    await waitFor(() => expect(lastListRequest()).toEqual(DEFAULT_REQUEST));
    expect(new URLSearchParams(window.location.search).get('workspace')).toBe('all');
  });

  it('sends a callout signal with the request and clears it from the chip', async () => {
    mount({ initialPresentation: { signal: 'escalated_unassigned' } });
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, signal: 'escalated_unassigned' });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.customerTickets.clearSignal' }));
    await waitFor(() => expect(lastListRequest()).toEqual(DEFAULT_REQUEST));
  });

  it('switches Working and Oversight by navigating to the Customer Tickets route', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.oversight' }));
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.push.mock.calls[0][0]).toMatch(/^\/msp\/tickets\/customer\?.*queueView=oversight/);
  });

  it('keeps a fixed client fixed and hides the client chooser (embedded client section)', async () => {
    mount({ fixedClientId: 'client-1', embedded: true });
    await screen.findByRole('link', { name: 'T-1 · Alpha ticket' });
    expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, clientId: 'client-1' });
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    openFilters();
    expect(screen.queryByLabelText('coManaged.customerTickets.client')).toBeNull();
  });
});
