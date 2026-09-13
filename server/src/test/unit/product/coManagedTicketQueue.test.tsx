/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketQueue from '../../../components/co-managed/CoManagedTicketQueue';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), export: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedTicketQueueActions', () => ({ getCoManagedTicketQueueAction: mocks.load, exportCoManagedTicketQueueAction: mocks.export }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, vars?: any) => vars ? `${key}:${JSON.stringify(vars)}` : key }),
  useFormatters: () => ({ formatDate: () => 'Formatted date' }), useOptionalI18n: () => null }));
const page = () => ({ page: 1, pageSize: 25, totalCount: 51, openCount: 50, closedCount: 1,
  workspaces: [{ tenant: 'msp', name: 'MSP' }, { tenant: 'customer', name: 'Customer IT' }],
  items: [{ tenant: 'msp', relationshipId: null, ticketId: 'same-id', workspaceName: 'MSP', fields: { title: 'Local ticket', ticket_number: 'T-1', responsibility: 'msp' } },
    { tenant: 'customer', relationshipId: 'relationship', ticketId: 'same-id', workspaceName: 'Customer IT', fields: { title: 'Customer ticket', ticket_number: 'T-1', responsibility: 'customer' } }] });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedTicketQueue /></CoManagedFeatureBoundary>);
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.load.mockResolvedValue(page()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('does not load or expose queue controls when the UI release flag is off', () => {
  mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); mount();
  expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});

it('exports all matching rows using applied filters and discards a download after navigation', async () => {
  let resolveExport!: (value: any) => void;
  mocks.export.mockReturnValue(new Promise(resolve => { resolveExport = resolve; }));
  mount(); await screen.findByRole('link', { name: 'T-1 · Customer ticket' });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));
  expect(mocks.export).toHaveBeenCalledWith({ view: 'working', state: 'open', sort: 'updated', direction: 'desc' });
  expect(screen.getByRole('button', { name: 'coManaged.queue.exporting' })).toBeDisabled();
  const createUrl = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });
  fireEvent.change(screen.getByLabelText('coManaged.queue.view'), { target: { value: 'oversight' } });
  await screen.findByRole('link', { name: 'T-1 · Customer ticket' });
  await act(async () => resolveExport({ filename: 'old.csv', csv: 'Old data', rowCount: 2 }));
  expect(createUrl).not.toHaveBeenCalled();
});

it('downloads the server export and clears stale queue contents when export authority is lost', async () => {
  mocks.export.mockResolvedValue({ filename: 'co-managed-working-tickets.csv', csv: 'CSV content', rowCount: 51 });
  const createUrl = vi.fn(() => 'blob:queue-export'), revokeUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeUrl, configurable: true });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('co-managed-working-tickets.csv'); });
  mount(); await screen.findByRole('link', { name: 'T-1 · Customer ticket' });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:queue-export'));
  mocks.export.mockRejectedValue(new Error('Revoked'));
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.export' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.queue.exportError');
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByRole('button', { name: 'coManaged.queue.export' })).toBeDisabled();
});
it('links identical IDs to their qualified native and shared routes and uses server pagination and totals', async () => {
  mount(); expect(await screen.findByRole('link', { name: 'T-1 · Local ticket' })).toHaveAttribute('href', '/msp/tickets/same-id');
  expect(screen.getByRole('link', { name: 'T-1 · Customer ticket' })).toHaveAttribute('href', '/msp/co-management/tickets/customer/relationship/same-id');
  expect(screen.getByText('coManaged.queue.counts:{"total":51,"open":50,"closed":1}')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.next' }));
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 25 })));
});
it('sends search and workspace/sort/view filters to the server and resets pagination', async () => {
  mount(); await screen.findByRole('link', { name: 'T-1 · Local ticket' });
  fireEvent.change(screen.getByLabelText('coManaged.queue.workspace'), { target: { value: 'customer' } });
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceTenant: 'customer', page: 1 })));
  fireEvent.change(screen.getByLabelText('coManaged.queue.search'), { target: { value: 'literal 100%' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.search' }));
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'literal 100%', workspaceTenant: 'customer' })));
  fireEvent.change(screen.getByLabelText('coManaged.queue.sort'), { target: { value: 'title' } });
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'title' })));
  fireEvent.change(screen.getByLabelText('coManaged.queue.view'), { target: { value: 'oversight' } });
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'oversight', workspaceTenant: undefined, page: 1 })));
});
it('discards stale queue responses and clears rows and counts when a refresh loses access', async () => {
  let resolveOld!: (value: any) => void;
  mocks.load.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  mount(); fireEvent.change(screen.getByLabelText('coManaged.queue.view'), { target: { value: 'oversight' } });
  await screen.findByRole('link', { name: 'T-1 · Customer ticket' });
  await act(async () => resolveOld({ ...page(), items: [{ ...page().items[0], fields: { title: 'Stale data' } }] }));
  expect(screen.queryByText('Stale data')).toBeNull();
  mocks.load.mockRejectedValue(new Error('Revoked'));
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.refresh' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.queue.loadError');
  expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByText(/coManaged.queue.counts:/)).toBeNull();
});
