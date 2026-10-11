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
}));

vi.mock('../../../lib/actions/coManagedTicketQueueActions', () => ({
  getCoManagedTicketQueueAction: mocks.load,
  exportCoManagedTicketQueueAction: mocks.export,
  bulkHandBackCoManagedTicketsAction: mocks.submit,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, vars?: any) => (vars && typeof vars === 'object' ? `${key}:${JSON.stringify(vars)}` : key) }),
  useFormatters: () => ({ formatDate: () => 'Formatted date' }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, label, value, disabled, options, onValueChange }: any) => (
    <label>{label}
      <select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
        {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
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

/** Two rows sharing one ticket id: one native MSP row, one shared handback-eligible row. */
const page = (overrides: Record<string, unknown> = {}) => ({
  page: 1,
  pageSize: 10,
  totalCount: 51,
  openCount: 50,
  closedCount: 1,
  workspaces: [{ tenant: 'msp', name: 'MSP' }, { tenant: 'customer', name: 'Customer IT' }],
  items: [
    { tenant: 'msp', relationshipId: null, ticketId: 'same-id', workspaceName: 'MSP',
      fields: { title: 'Local ticket', ticket_number: 'T-1', responsibility: 'msp' } },
    { tenant: 'customer', relationshipId: 'relationship', ticketId: 'same-id', workspaceName: 'Customer IT',
      fields: { title: 'Customer ticket', ticket_number: 'T-1', responsibility: 'msp', work_revision: 4 } },
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
const listRequests = () => mocks.load.mock.calls.map(call => call[0]).filter(request => 'sort' in request);
const lastListRequest = () => listRequests().at(-1);

beforeEach(() => {
  vi.resetAllMocks();
  window.sessionStorage.clear();
  // Echo the requested page back, the way a real server does: a stand-in that
  // always answers `page: 1` would make "go to the next page" untestable.
  mocks.load.mockImplementation(async (request: any) => page({ page: request?.page ?? 1 }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// --- T007: toolbar, sort, reset, pagination ------------------------------

describe('T007 — applied filters, sort and pagination reach the server', () => {
  it('issues the default qualified request for its scope', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
    expect(listRequests()).toEqual([DEFAULT_REQUEST]);
  });

  it('sends the submitted search and each toolbar filter, resetting to page 1 every time', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });

    // Typing alone must not query: the search is applied on submit.
    fireEvent.change(screen.getByLabelText('coManaged.queue.search'), { target: { value: 'literal 100%' } });
    expect(listRequests()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.search' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, search: 'literal 100%' }));

    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, search: 'literal 100%', state: 'closed' }));

    fireEvent.change(screen.getByLabelText('coManaged.queue.sort'), { target: { value: 'title' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, search: 'literal 100%', state: 'closed', sort: 'title' }));

    fireEvent.change(screen.getByLabelText('coManaged.queue.direction'), { target: { value: 'asc' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, search: 'literal 100%', state: 'closed', sort: 'title', direction: 'asc' }));
  });

  it('resets to page 1 when a filter changes, so page 3 of the old filter is never asked for', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });

    // Leave page 1 first — otherwise "resets to page 1" is trivially true.
    fireEvent.click(screen.getByRole('button', { name: 'next-page' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, page: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'next-page' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, page: 3 }));

    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, state: 'closed', page: 1 }));
  });

  it('returns every filter to its default on reset', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'all' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, state: 'all' }));

    fireEvent.click(screen.getByRole('button', { name: 'resetFilters' }));
    await waitFor(() => expect(lastListRequest()).toEqual(DEFAULT_REQUEST));
  });

  it('pages and sorts through the server, carrying the applied filters and never paging a stale filter', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });

    fireEvent.click(screen.getByRole('button', { name: 'next-page' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, page: 2 }));

    // A column sort is a new ordering, so it must go back to page 1 — asserted
    // from page 2, not from page 1 where it would hold for free.
    fireEvent.click(screen.getByRole('button', { name: 'sort-title-asc' }));
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, sort: 'title', direction: 'asc', page: 1 }));
  });

  it('links identical ids to their qualified native and shared routes and shows the server totals', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'T-1 · Local ticket' }))
      .toHaveAttribute('href', '/msp/tickets/same-id');
    expect(screen.getByRole('link', { name: 'T-1 · Customer ticket' }))
      .toHaveAttribute('href', '/msp/co-management/tickets/customer/relationship/same-id');
    // The counts come from the server response, not from the rows on screen.
    expect(screen.getByText('coManaged.queue.counts:{"total":51,"open":50,"closed":1}')).toBeInTheDocument();
  });
});

// --- T010: export lifetime ------------------------------------------------

describe('T010 — export uses the applied filters and never outlives them', () => {
  it('exports every match of the applied filters, without page bounds', async () => {
    mocks.export.mockResolvedValue({ filename: 'q.csv', csv: 'CSV', rowCount: 51 });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:q'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
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
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
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
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));

    // Leave the scope the export was requested for.
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
    await act(async () => resolveExport({ filename: 'old.csv', csv: 'Old data', rowCount: 2 }));

    // The rows on screen are no longer the rows this CSV describes.
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('drops the visible rows when export authority is lost, rather than leaving protected rows on screen', async () => {
    mocks.export.mockRejectedValue(new Error('Revoked'));
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
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
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });

    await act(async () => resolveOld(page({
      items: [{ tenant: 'msp', relationshipId: null, ticketId: 'stale', workspaceName: 'MSP',
        fields: { title: 'Stale data', ticket_number: 'T-9', responsibility: 'msp' } }],
    })));

    expect(screen.queryByText('Stale data')).toBeNull();
    expect(screen.getByRole('link', { name: 'T-1 · Local ticket' })).toBeInTheDocument();
  });

  it('clears rows and counts when a refresh loses access', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
    mocks.load.mockRejectedValue(new Error('Revoked'));
    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.queue.loadError');
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.queryByText(/^coManaged\.queue\.counts:/)).toBeNull();
  });
});

// --- T012: selection column feeds the single composer ---------------------

describe('T012 — selection offers exactly the handback-eligible shared rows', () => {
  it('offers a checkbox only for eligible shared rows, never for native or revision-masked ones', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
    // Two rows are on screen; only the shared, MSP-held, revision-bearing one
    // may be handed back. Plus the select-all in the column header.
    expect(screen.getByRole('checkbox', { name: 'co-managed-ticket-list-select-all' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^co-managed-ticket-list-select-shared\|/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^co-managed-ticket-list-select-native\|/ })).toBeNull();
  });

  it('offers no selection at all when nothing on the page is eligible', async () => {
    mocks.load.mockResolvedValue(page({
      items: [
        { tenant: 'msp', relationshipId: null, ticketId: 'native-only', workspaceName: 'MSP',
          fields: { title: 'Local ticket', ticket_number: 'T-1', responsibility: 'msp' } },
        // Shared, but the customer holds it.
        { tenant: 'customer', relationshipId: 'relationship', ticketId: 'customer-held', workspaceName: 'Customer IT',
          fields: { title: 'Customer ticket', ticket_number: 'T-2', responsibility: 'customer', work_revision: 4 } },
        // Shared and MSP-held, but the revision is masked.
        { tenant: 'customer', relationshipId: 'relationship', ticketId: 'masked', workspaceName: 'Customer IT',
          fields: { title: 'Masked ticket', ticket_number: 'T-3', responsibility: 'msp' } },
      ],
    }));
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });

  it('hands the selected eligible rows to one composer, which freezes the exact command', async () => {
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }]);
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });

    fireEvent.click(screen.getByRole('checkbox', { name: /^co-managed-ticket-list-select-shared\|/ }));
    fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Continue locally' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));

    await screen.findByRole('status');
    const request = mocks.submit.mock.lastCall![0];
    expect(request.note).toBe('Continue locally');
    // Exactly the one eligible row — the native sibling sharing its ticket id
    // must not be swept in.
    expect(request.items).toHaveLength(1);
    expect(request.items[0].resource).toMatchObject({ kind: 'ticket', tenant: 'customer', relationshipId: 'relationship', id: 'same-id' });
    expect(request.items[0].expectedRevision).toBe(4);
  });

  it('select-all takes every eligible row and no others', async () => {
    mocks.load.mockResolvedValue(page({
      items: [
        { tenant: 'msp', relationshipId: null, ticketId: 'native', workspaceName: 'MSP',
          fields: { title: 'Local ticket', ticket_number: 'T-1', responsibility: 'msp' } },
        { tenant: 'a', relationshipId: 'rel-a', ticketId: 'ticket-a', workspaceName: 'Customer A',
          fields: { title: 'A', ticket_number: 'T-2', responsibility: 'msp', work_revision: 1 } },
        { tenant: 'b', relationshipId: 'rel-b', ticketId: 'ticket-b', workspaceName: 'Customer B',
          fields: { title: 'B', ticket_number: 'T-3', responsibility: 'msp', work_revision: 5 } },
      ],
    }));
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }, { index: 1, ok: true, receipt: {} }]);
    mount();
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });

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
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });
    fireEvent.click(screen.getByRole('checkbox', { name: /^co-managed-ticket-list-select-shared\|/ }));
    expect(screen.getByRole('checkbox', { name: /^co-managed-ticket-list-select-shared\|/ })).toBeChecked();

    fireEvent.change(screen.getByLabelText('coManaged.queue.state'), { target: { value: 'closed' } });
    await waitFor(() => expect(lastListRequest()).toEqual({ ...DEFAULT_REQUEST, state: 'closed' }));
    await screen.findByRole('link', { name: 'T-1 · Local ticket' });

    expect(screen.getByRole('checkbox', { name: /^co-managed-ticket-list-select-shared\|/ })).not.toBeChecked();
  });
});
