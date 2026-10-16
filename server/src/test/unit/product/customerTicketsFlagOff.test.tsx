/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
import QualifiedTicketList from '../../../components/co-managed/QualifiedTicketList';

/**
 * T017 (amendment): the release flag is presentation only. Turning it off while a
 * load, export or handback is in flight removes the list, discards late results,
 * and never mints a fresh retry identity when the flag comes back.
 *
 * Customer Tickets rows (amendment): F015 / F021 / F032 / T009 / T013 / T017.
 * Shared-ticket rows only: duplicate ids across customers stay separate, redacted
 * fields stay redacted, load failures are retryable, and an unfiltered empty list
 * is not described as a failed filter.
 */

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
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
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../components/co-managed/CoManagedAcceptanceBoundary', () => ({ default: ({ children }: any) => <>{children}</> }));
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
const ON = { enabled: true, loading: false, error: null };
const OFF = { enabled: false, loading: false, error: null };
const ROWS = {
  page: 1, pageSize: 10, totalCount: 1, openCount: 1, closedCount: 0,
  workspaces: [{ tenant: 'a', name: 'Customer A' }],
  items: [{ tenant: 'a', relationshipId: 'rel-a', ticketId: 't-1', workspaceName: 'Customer A',
    fields: { ticket_number: 'T-1', title: 'Printer A', responsibility: 'msp', work_revision: 2 } }],
};
const tree = () => (
  <CoManagedFeatureBoundary fallback={<p>unavailable</p>}>
    <QualifiedTicketList scope={SCOPE} actorScope="msp-tenant:user-1" />
  </CoManagedFeatureBoundary>
);

beforeEach(() => {
  vi.resetAllMocks();
  window.sessionStorage.clear();
  mocks.flag.mockReturnValue(ON);
  mocks.load.mockResolvedValue(ROWS);
  mocks.clients.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('T017 — flag turned off mid-flight', () => {
  it('drops a load that resolves after the flag went off', async () => {
    let resolveLoad!: (value: any) => void;
    mocks.load.mockImplementation(() => new Promise(resolve => { resolveLoad = resolve; }));
    const view = render(tree());
    mocks.flag.mockReturnValue(OFF);
    view.rerender(tree());
    expect(screen.getByText('unavailable')).toBeTruthy();
    await act(async () => resolveLoad(ROWS));
    expect(screen.queryByRole('link', { name: 'T-1 · Printer A' })).toBeNull();
    expect(screen.getByText('unavailable')).toBeTruthy();
  });

  it('does not download an export that completes after the flag went off', async () => {
    let resolveExport!: (value: any) => void;
    mocks.export.mockReturnValue(new Promise(resolve => { resolveExport = resolve; }));
    const createUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });
    const view = render(tree());
    await screen.findByRole('link', { name: 'T-1 · Printer A' });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));
    mocks.flag.mockReturnValue(OFF);
    view.rerender(tree());
    await act(async () => resolveExport({ filename: 'late.csv', csv: 'late', rowCount: 1 }));
    expect(createUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'coManaged.queue.export' })).toBeNull();
  });

  it('shows no late handback result, and re-enabling offers the SAME frozen command without submitting it', async () => {
    let resolveSubmit!: (value: any) => void;
    mocks.submit.mockReturnValue(new Promise(resolve => { resolveSubmit = resolve; }));
    const view = render(tree());
    await screen.findByRole('link', { name: 'T-1 · Printer A' });
    fireEvent.click(screen.getAllByRole('checkbox').find(box => !box.id.endsWith('select-all'))!);
    fireEvent.change(await screen.findByLabelText('coManaged.ticket.note'), { target: { value: 'Back to you' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    const first = mocks.submit.mock.calls[0][0];

    mocks.flag.mockReturnValue(OFF);
    view.rerender(tree());
    await act(async () => resolveSubmit([{ index: 0, ok: true, receipt: {} }]));
    expect(screen.queryByRole('status')).toBeNull();

    mocks.flag.mockReturnValue(ON);
    view.rerender(tree());
    // Unresolved from the browser's point of view: offered for resume, never auto-sent.
    expect(await screen.findByText('coManaged.queue.bulkHandback.resume')).toBeTruthy();
    expect(mocks.submit).toHaveBeenCalledOnce();
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }]);
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[1][0]).toEqual(first);
  });
});
