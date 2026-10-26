/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QualifiedTicketList from '../../../components/co-managed/QualifiedTicketList';

/**
 * Customer Tickets rows (amendment): F015 / F021 / F032 / T009 / T013 / T017.
 * Shared-ticket rows only: duplicate ids across customers stay separate, redacted
 * fields stay redacted, load failures are retryable, and an unfiltered empty list
 * is not described as a failed filter.
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

const shared = (tenant: string, relationshipId: string, name: string, fields: Record<string, unknown>) => ({
  tenant, relationshipId, ticketId: 'same-id', workspaceName: name, fields: { ticket_number: 'T-1', ...fields },
});
const page = (items: any[], overrides: Record<string, unknown> = {}) => ({
  page: 1, pageSize: 10, totalCount: items.length, openCount: items.length, closedCount: 0,
  workspaces: [{ tenant: 'a', name: 'Customer A' }, { tenant: 'b', name: 'Customer B' }],
  items, ...overrides,
});
const TWO = [
  shared('a', 'rel-a', 'Customer A', { title: 'Printer A', responsibility: 'msp', work_revision: 2 }),
  shared('b', 'rel-b', 'Customer B', { title: 'Printer B', responsibility: 'msp', work_revision: 5 }),
];
const mount = () => render(<QualifiedTicketList scope={SCOPE} actorScope={ACTOR} />);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.resetAllMocks();
  window.sessionStorage.clear();
  mocks.load.mockResolvedValue(page(TWO));
  mocks.clients.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('F015 / T009 — shared rows keep their qualified identity', () => {
  it('links two tickets with the same id to their own customer workspace', async () => {
    mount();
    const a = await screen.findByRole('link', { name: 'T-1 · Printer A' });
    const b = await screen.findByRole('link', { name: 'T-1 · Printer B' });
    // Each link names its own customer workspace and relationship, and carries the list it was opened from
    // (a46feefa6f) so the shared ticket can return to the same qualified view.
    const href = (link: HTMLElement) => new URL(link.getAttribute('href')!, 'https://alga.invalid');
    expect(href(a).pathname).toBe('/msp/co-management/tickets/a/rel-a/same-id');
    expect(href(b).pathname).toBe('/msp/co-management/tickets/b/rel-b/same-id');
    for (const link of [a, b]) expect(href(link).searchParams.get('returnTo')).toBe('/msp/tickets/customer?queueView=working&workspace=all');
  });

  it('selects one of two same-id rows without selecting the other', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Printer A' });
    const boxes = screen.getAllByRole('checkbox').filter(box => !box.id.endsWith('select-all'));
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it('shows Restricted, not a blank or a guess, for a redacted title', async () => {
    mocks.load.mockResolvedValue(page([shared('a', 'rel-a', 'Customer A', { responsibility: 'msp', work_revision: 2 })]));
    mount();
    expect((await screen.findAllByText(/coManaged\.ticket\.restricted/)).length).toBeGreaterThan(0);
  });

  it('does not offer selection for a row the MSP no longer holds', async () => {
    mocks.load.mockResolvedValue(page([
      shared('a', 'rel-a', 'Customer A', { title: 'Back with customer', responsibility: 'customer', work_revision: 3 }),
    ]));
    mount();
    await screen.findByRole('link', { name: 'T-1 · Back with customer' });
    expect(screen.queryAllByRole('checkbox').filter(box => !box.id.endsWith('select-all') && !(box as HTMLInputElement).disabled)).toHaveLength(0);
  });
});

describe('F032 — load failure and empty states', () => {
  it('offers Retry after a failed load and recovers on the second read', async () => {
    mocks.load.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(page(TWO));
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('coManaged.queue.loadError');
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.retry' }));
    await screen.findByRole('link', { name: 'T-1 · Printer A' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says there is nothing yet (not "no match") when unfiltered and empty', async () => {
    mocks.load.mockResolvedValue(page([], { totalCount: 0, openCount: 0 }));
    mount();
    expect(await screen.findByText('coManaged.queue.emptyUnfiltered')).toBeTruthy();
    expect(screen.queryByText('coManaged.queue.empty')).toBeNull();
  });

  it('says no match when a search is applied', async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Printer A' });
    mocks.load.mockResolvedValue(page([], { totalCount: 0, openCount: 0 }));
    const box = screen.getByLabelText('coManaged.queue.search');
    fireEvent.change(box, { target: { value: 'zzz' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('coManaged.queue.empty')).toBeTruthy();
  });
});

describe('T013 — handback of one row leaves the other untouched', () => {
  it('sends only the selected row, with its own tenant, relationship and revision', async () => {
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }]);
    mount();
    await screen.findByRole('link', { name: 'T-1 · Printer B' });
    const boxes = screen.getAllByRole('checkbox').filter(box => !box.id.endsWith('select-all'));
    fireEvent.click(boxes[1]);
    fireEvent.change(await screen.findByLabelText('coManaged.ticket.note'), { target: { value: 'Back to you' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    const sent = mocks.submit.mock.calls[0][0];
    expect(sent.items).toHaveLength(1);
    expect(sent.items[0].expectedRevision).toBe(5);
    expect(sent.items[0].resource).toEqual({ kind: 'ticket', tenant: 'b', relationshipId: 'rel-b', id: 'same-id' });
  });
});

describe('T013 — an uncertain handback cannot be replaced by a new command', () => {
  const failOnce = () => mocks.submit.mockRejectedValueOnce(new Error('transport lost'))
    .mockResolvedValue([{ index: 0, ok: true, receipt: {} }]);
  const submitFirst = async () => {
    mount();
    await screen.findByRole('link', { name: 'T-1 · Printer A' });
    fireEvent.click(screen.getAllByRole('checkbox').filter(box => !box.id.endsWith('select-all'))[0]);
    fireEvent.change(await screen.findByLabelText('coManaged.ticket.note'), { target: { value: 'Original note' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));
    await screen.findByText('coManaged.ticket.uncertain');
  };

  it('locks the note and replays the identical command on retry', async () => {
    failOnce();
    await submitFirst();
    const note = screen.getByLabelText('coManaged.ticket.note') as HTMLTextAreaElement;
    expect(note.disabled).toBe(true);
    fireEvent.change(note, { target: { value: 'Edited note' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
    await screen.findByRole('status');
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[1][0]).toEqual(mocks.submit.mock.calls[0][0]);
    expect(mocks.submit.mock.calls[1][0].note).toBe('Original note');
  });

  it('does not send a different row if the selection changes while the result is uncertain', async () => {
    failOnce();
    await submitFirst();
    const other = screen.getAllByRole('checkbox').filter(box => !box.id.endsWith('select-all'))[1];
    fireEvent.click(other);
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
    await screen.findByRole('status');
    const retried = mocks.submit.mock.calls[1][0];
    expect(retried.items).toHaveLength(1);
    expect(retried.items[0].resource.tenant).toBe('a');
    expect(retried.items[0].operationId).toBe(mocks.submit.mock.calls[0][0].items[0].operationId);
  });

  it('keeps the frozen command for a reload after a filter change, and never auto-submits it', async () => {
    failOnce();
    await submitFirst();
    const stored = Object.keys(window.sessionStorage).filter(key => key.startsWith('co-managed:handback-intent:'));
    expect(stored).toHaveLength(1);
    cleanup();
    mocks.submit.mockClear();
    mount();
    expect(await screen.findByText('coManaged.queue.bulkHandback.resume')).toBeTruthy();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

describe('F006 — the address bar wins when Back restores the route as first rendered', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('adopts the applied filters from the URL instead of the stale server-rendered presentation', async () => {
    window.history.replaceState(null, '', '/msp/tickets/customer?queueView=working&workspace=all&searchQuery=Printer&queueState=closed');
    mount(); // the server-supplied presentation is the default, as after Back
    await waitFor(() => expect(mocks.load.mock.calls.map(call => call[0]).filter(request => 'sort' in request).at(-1))
      .toMatchObject({ search: 'Printer', state: 'closed' }));
    expect((screen.getByLabelText('coManaged.queue.search') as HTMLInputElement).value).toBe('Printer');
  });

  it('leaves the defaults alone when the URL carries no filters', async () => {
    window.history.replaceState(null, '', '/msp/tickets/customer');
    mount();
    await screen.findByRole('link', { name: 'T-1 · Printer A' });
    expect(mocks.load.mock.calls.map(call => call[0]).filter(request => 'sort' in request)).toHaveLength(1);
  });
});
