/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const WS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(), push: vi.fn(), read: vi.fn(), exportCsv: vi.fn(), handback: vi.fn(), admitted: { value: true },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: mocks.push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => ({ enabled: true, admitted: mocks.admitted.value, resolved: true }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: any) => typeof options === 'string' ? options : options?.defaultValue ?? key }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));
vi.mock('@/lib/actions/coManagedTicketQueueActions', () => ({
  getCoManagedTicketQueueAction: (...a: any[]) => mocks.read(...a),
  exportCoManagedTicketQueueAction: (...a: any[]) => mocks.exportCsv(...a),
  bulkHandBackCoManagedTicketsAction: (...a: any[]) => mocks.handback(...a),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant: _v, size: _s, ...rest }: any) => <button {...rest}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: ({ label, ...rest }: any) => <label>{label}<textarea {...rest} /></label> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ indeterminate: _i, skipRegistration: _s, ...rest }: any) => <input type="checkbox" {...rest} />,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select id={id} value={value} onChange={event => onValueChange(event.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/ShareActionsMenu', () => ({
  ShareActionsMenu: ({ actions }: any) => <div>{actions.map((a: any) => <button key={a.id} id={a.id} disabled={a.disabled} onClick={a.onSelect}>{a.label}</button>)}</div>,
}));
vi.mock('@alga-psa/ui/components/ListToolbar', () => ({
  LIST_FILTER_DENSITY_PRESETS: [{ filterPadding: '' }],
  ListCard: ({ children }: any) => <div>{children}</div>,
  ListPageHeading: ({ title, actions }: any) => <header><h1>{title}</h1>{actions}</header>,
  ListToolbarRow: ({ children }: any) => <div>{children}</div>,
  ListToolbarSurface: ({ children }: any) => <div>{children}</div>,
  ListToolbarResetButton: ({ id, label, onClick }: any) => <button id={id} onClick={onClick}>{label}</button>,
  ListToolbarSearchInput: ({ id, value, onChange }: any) => <input id={id} value={value} onChange={onChange} />,
  useDebouncedSearchField: (value: string) => ({ draft: value, setDraft: () => {}, flush: () => {} }),
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: (props: any) => (
    <table id={props.id} data-page={props.currentPage} data-total={props.totalItems} data-page-size={props.pageSize}>
      <thead><tr>{props.columns.map((c: any) => <th key={c.dataIndex}>{c.title}</th>)}</tr></thead>
      <tbody>{props.data.map((row: any) => (
        <tr key={`${row.tenant}:${row.ticketId}`}>{props.columns.map((c: any) => <td key={c.dataIndex}>{c.render ? c.render(undefined, row) : null}</td>)}</tr>
      ))}</tbody>
      <tfoot><tr><td>
        <button id={`${props.id}-size-25`} onClick={() => { props.onItemsPerPageChange(25); props.onPageChange(1); }}>size 25</button>
        <button id={`${props.id}-next`} onClick={() => props.onPageChange(props.currentPage + 1)}>next</button>
      </td></tr></tfoot>
    </table>
  ),
}));

import QualifiedTicketList, { queueHasMore, queueRequestFromUrlState } from '@/components/co-managed/QualifiedTicketList';
import { DEFAULT_TICKET_LIST_PRESENTATION } from '@alga-psa/tickets/lib';

const scope = { kind: 'qualified' as const, view: 'working' as const, workspace: 'all' as const };
const presentation = { ...DEFAULT_TICKET_LIST_PRESENTATION };

const item = (id: string, tenant: string, canHandBack: boolean, extra: Record<string, unknown> = {}) => ({
  tenant, relationshipId: `rel-${tenant}`, ticketId: id, workspaceName: tenant === WS_A ? 'Acme' : 'Beta', canHandBack,
  fields: { ticket_number: `T-${id}`, title: `Title ${id}`, status_name: 'Open', priority_name: 'High', responsibility: 'msp', work_revision: 3, updated_at: '2026-01-02T00:00:00Z', ...extra },
});
const page = (items: any[], over: Record<string, unknown> = {}) => ({
  items, workspaces: [{ tenant: WS_A, name: 'Acme' }, { tenant: WS_B, name: 'Beta' }], totalCount: items.length, openCount: items.length, closedCount: 0, page: 1, pageSize: 10,
  signals: { escalatedUnassigned: 0, awaitingReply: 0 }, assignedRelationshipCount: 2, ...over,
});

beforeEach(() => {
  Object.values(mocks).forEach(m => { if (typeof m === 'function') (m as any).mockReset(); });
  mocks.admitted.value = true;
});

describe('QualifiedTicketList: capability-driven handback affordances', () => {
  it('a writer gets row checkboxes, select-all and the composer once something is selected', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, true), item('2', WS_A, true)]));
    render(<QualifiedTicketList scope={scope} presentation={presentation} />);
    expect(await screen.findByLabelText('Select all returnable tickets')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Select ticket')).toHaveLength(2);
    expect(screen.queryByText('Return tickets to customer IT')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select all returnable tickets'));
    expect(await screen.findByText('Return tickets to customer IT')).toBeInTheDocument();
  });

  it('a read-only viewer (canHandBack=false on every row) gets no checkboxes, no select-all and no composer', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, false), item('2', WS_A, false)]));
    const { container } = render(<QualifiedTicketList scope={scope} presentation={presentation} />);
    await screen.findByText('T-1');
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(screen.queryByLabelText('Select all returnable tickets')).not.toBeInTheDocument();
    expect(screen.queryByText('Return tickets to customer IT')).not.toBeInTheDocument();
  });

  it('only rows the server marked canHandBack are selectable in a mixed page', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, true), item('2', WS_A, false)]));
    render(<QualifiedTicketList scope={scope} presentation={presentation} />);
    await screen.findByText('T-1');
    expect(screen.getAllByLabelText('Select ticket')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Select all returnable tickets'));
    expect(await screen.findByText('{{count}} selected ticket(s) will be returned.')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Select ticket').filter(el => (el as HTMLInputElement).checked)).toHaveLength(1);
  });

  it('a capability that does not admit writes hides selection even when the row says canHandBack', async () => {
    mocks.admitted.value = false;
    mocks.read.mockResolvedValue(page([item('1', WS_A, true)]));
    const { container } = render(<QualifiedTicketList scope={scope} presentation={presentation} />);
    await screen.findByText('T-1');
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('a row that is not MSP-held is not selectable even for a writer', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, true, { responsibility: 'customer' })]));
    const { container } = render(<QualifiedTicketList scope={scope} presentation={presentation} />);
    await screen.findByText('T-1');
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });
});

describe('QualifiedTicketList: URL-derived filter and paging', () => {
  it('reads with exactly what the URL says and offers workspace options only from the read', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, false)]));
    render(<QualifiedTicketList scope={{ ...scope, workspace: { tenant: WS_A } }} presentation={presentation} />);
    await screen.findByText('T-1');
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ view: 'working', workspaceTenant: WS_A, state: 'open', page: 1 }));
    const options = Array.from((document.getElementById('customer-tickets-workspace') as HTMLSelectElement).options).map(o => o.textContent);
    expect(options).toEqual(['All workspaces', 'Acme', 'Beta']);
  });

  it('choosing a workspace replaces the URL (page 1) instead of filtering locally', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, false), item('2', WS_B, false)]));
    render(<QualifiedTicketList scope={scope} presentation={{ ...presentation, page: 3 }} />);
    await screen.findByText('T-1');
    fireEvent.change(document.getElementById('customer-tickets-workspace')!, { target: { value: WS_B } });
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    const url = new URL(mocks.replace.mock.calls[0][0], 'http://x');
    expect(url.pathname).toBe('/msp/tickets/customer');
    expect(url.searchParams.get('workspace')).toBe(WS_B);
    expect(url.searchParams.get('page')).toBeNull();
    // Both rows are still on screen: narrowing is the server's job on the next read.
    expect(screen.getByText('T-2')).toBeInTheDocument();
  });

  it('keeps an unavailable selected workspace visible so it can be reset', async () => {
    mocks.read.mockResolvedValue(page([]));
    render(<QualifiedTicketList scope={{ ...scope, workspace: { tenant: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }} presentation={presentation} />);
    await screen.findByText('No permitted tickets match these filters.');
    const select = document.getElementById('customer-tickets-workspace') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent)).toContain('Unavailable workspace');
  });

  it('paging is a URL move and respects hasMore (no accumulation of pages)', async () => {
    expect(queueHasMore({ page: 1, pageSize: 10, totalCount: 10 })).toBe(false);
    expect(queueHasMore({ page: 1, pageSize: 10, totalCount: 11 })).toBe(true);
    expect(queueHasMore({ page: 2, pageSize: 10, totalCount: 20 })).toBe(false);
    mocks.read.mockResolvedValue(page([item('1', WS_A, false)], { totalCount: 25, pageSize: 10 }));
    render(<QualifiedTicketList scope={scope} presentation={presentation} />);
    await screen.findByText('T-1');
    expect(document.getElementById('customer-tickets-table')).toHaveAttribute('data-total', '25');
    fireEvent.click(document.getElementById('customer-tickets-table-next')!);
    expect(new URL(mocks.replace.mock.calls[0][0], 'http://x').searchParams.get('page')).toBe('2');
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it('changing the page size from page 3 keeps the size when DataTable follows it with onPageChange(1)', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, false)], { totalCount: 80, pageSize: 10, page: 3 }));
    render(<QualifiedTicketList scope={scope} presentation={{ ...presentation, page: 3 }} />);
    await screen.findByText('T-1');
    fireEvent.click(document.getElementById('customer-tickets-table-size-25')!);
    expect(mocks.replace).toHaveBeenCalledTimes(2);
    const url = new URL(mocks.replace.mock.calls.at(-1)![0], 'http://x');
    expect(url.searchParams.get('pageSize')).toBe('25');
    expect([null, '1']).toContain(url.searchParams.get('page'));
  });

  it('a page past the end lands on the last page', async () => {
    mocks.read.mockResolvedValue(page([], { totalCount: 25, pageSize: 10, page: 9 }));
    render(<QualifiedTicketList scope={scope} presentation={{ ...presentation, page: 9 }} />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(new URL(mocks.replace.mock.calls[0][0], 'http://x').searchParams.get('page')).toBe('3');
  });

  it('queueRequestFromUrlState carries workspace, search, state, sort and paging', () => {
    expect(queueRequestFromUrlState({ ...scope, workspace: { tenant: WS_A } }, { ...presentation, searchQuery: 'vpn', state: 'closed', sort: 'title', direction: 'asc', page: 2, pageSize: 25 }))
      .toEqual({ view: 'working', workspaceTenant: WS_A, search: 'vpn', state: 'closed', sort: 'title', direction: 'asc', page: 2, pageSize: 25 });
  });
});

describe('QualifiedTicketList: export', () => {
  it('exports through the action with the same filters and no paging', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, true)]));
    mocks.exportCsv.mockResolvedValue({ csv: 'a', filename: 'x.csv', rowCount: 1 });
    (URL as any).createObjectURL = vi.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = vi.fn();
    render(<QualifiedTicketList scope={{ ...scope, workspace: { tenant: WS_A } }} presentation={{ ...presentation, searchQuery: 'vpn' }} />);
    await screen.findByText('T-1');
    await act(async () => { fireEvent.click(document.getElementById('customer-tickets-export')!); });
    await waitFor(() => expect(mocks.exportCsv).toHaveBeenCalled());
    const request = mocks.exportCsv.mock.calls[0][0];
    expect(request).toMatchObject({ view: 'working', workspaceTenant: WS_A, search: 'vpn', state: 'open' });
    expect(request).not.toHaveProperty('page');
    expect(request).not.toHaveProperty('pageSize');
  });
});

describe('QualifiedTicketList: ids', () => {
  it('the list root, its controls and the handback composer never share an id', async () => {
    mocks.read.mockResolvedValue(page([item('1', WS_A, true), item('2', WS_B, true)]));
    const { container } = render(<QualifiedTicketList scope={scope} presentation={presentation} />);
    await screen.findByText('T-1');
    fireEvent.click(screen.getByLabelText('Select all returnable tickets'));
    await screen.findByText('Return tickets to customer IT');
    const ids = Array.from(container.querySelectorAll('[id]')).map(el => el.id);
    expect(ids).toContain('customer-tickets');
    expect(ids).toContain('customer-tickets-handback');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
