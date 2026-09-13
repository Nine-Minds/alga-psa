/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketEditor from '../../../components/co-managed/CoManagedTicketEditor';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), search: vi.fn(), save: vi.fn(), saved: vi.fn(), reload: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedTicketEditActions', () => ({ getSharedTicketEditorAction: mocks.load, searchSharedTicketEditOptionsAction: mocks.search, saveSharedTicketEditAction: mocks.save }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    <option value="">Choose</option>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.field ? `${key}: ${options.field}` : key }), useOptionalI18n: () => null }));
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const initial = () => ({ resource, values: { title: 'Original title', status_id: 'status-a', priority_id: 'priority-a', due_date: null, response_state: null, url: null },
  editableFields: ['title', 'status_id', 'priority_id', 'due_date', 'response_state', 'url'], selectedOptions: { status_id: { id: 'status-a', name: 'New' }, priority_id: { id: 'priority-a', name: 'Normal' } } });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const title = () => screen.getByLabelText('coManaged.editor.fields.title');
const saveButton = () => screen.getByRole('button', { name: 'coManaged.editor.save' });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedTicketEditor resource={resource} onSaved={mocks.saved} onReload={mocks.reload} /></CoManagedFeatureBoundary>);
beforeEach(() => {
  vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.load.mockResolvedValue(initial());
  mocks.search.mockResolvedValue({ options: [], nextAfterId: null }); mocks.save.mockResolvedValue({ ok: true, receipt: { operationId: 'saved' } });
});
afterEach(cleanup);

it('does not mount editor reads or controls with the UI release flag off', () => {
  mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); mount();
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});
it('sends only changed fields with their original baselines and the qualified ticket identity', async () => {
  mount(); await screen.findByDisplayValue('Original title'); expect(saveButton()).toBeDisabled();
  fireEvent.change(title(), { target: { value: 'Shared edit' } }); fireEvent.click(saveButton());
  await waitFor(() => expect(mocks.saved).toHaveBeenCalledTimes(1));
  expect(mocks.save).toHaveBeenCalledWith(resource, { operationId: expect.any(String), expected: { title: 'Original title' }, patch: { title: 'Shared edit' } });
});
it.each(['throw', 'unknown-result'])('freezes an uncertain %s submission and retries the exact request', async mode => {
  if (mode === 'throw') mocks.save.mockRejectedValueOnce(new Error('Lost response'));
  else mocks.save.mockResolvedValueOnce({ ok: false, code: 'unknownOutcome' });
  mount(); await screen.findByDisplayValue('Original title'); fireEvent.change(title(), { target: { value: 'Retained request' } }); fireEvent.click(saveButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.editor.errors.unknownOutcome');
  expect(title()).toBeDisabled();
  const first = structuredClone(mocks.save.mock.calls[0]);
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
  await waitFor(() => expect(mocks.saved).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[1]).toEqual(first);
});
it('requires reload after a conflict and clears visible editor data after revoked access', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, code: 'conflict' });
  mount(); await screen.findByDisplayValue('Original title'); fireEvent.change(title(), { target: { value: 'Draft' } }); fireEvent.click(saveButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.editor.errors.conflict');
  expect(title()).toBeDisabled(); expect(saveButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.editor.reload' })); expect(mocks.reload).toHaveBeenCalledTimes(1);
  cleanup(); mocks.save.mockResolvedValue({ ok: false, code: 'forbidden' });
  mount(); await screen.findByDisplayValue('Original title'); fireEvent.change(title(), { target: { value: 'Draft' } }); fireEvent.click(saveButton());
  expect(await screen.findByText('coManaged.editor.loadError')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Draft')).toBeNull(); expect(screen.queryByLabelText('coManaged.editor.fields.status_id')).toBeNull();
});
it.each(['closeRules', 'slaSetupRequired'])('allows a corrected save with a new operation ID after a known %s failure', async code => {
  mocks.save.mockResolvedValueOnce({ ok: false, code });
  mount(); await screen.findByDisplayValue('Original title'); fireEvent.change(title(), { target: { value: 'First draft' } }); fireEvent.click(saveButton());
  await screen.findByText(`coManaged.editor.errors.${code}`); expect(title()).not.toBeDisabled();
  fireEvent.change(title(), { target: { value: 'Corrected draft' } }); fireEvent.click(saveButton());
  await waitFor(() => expect(mocks.saved).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[1][1]).toMatchObject({ expected: { title: 'Original title' }, patch: { title: 'Corrected draft' } });
  expect(mocks.save.mock.calls[1][1].operationId).not.toBe(mocks.save.mock.calls[0][1].operationId);
});
it('shows permitted values without edit controls or picklist reads when access is read-only', async () => {
  mocks.load.mockResolvedValue({ ...initial(), editableFields: [] }); mount(); await screen.findByDisplayValue('Original title');
  expect(title()).toBeDisabled(); expect(screen.queryByRole('button', { name: 'coManaged.editor.save' })).toBeNull();
  expect(mocks.search).not.toHaveBeenCalled();
});
it('discards old reads and save callbacks when navigation changes the qualified ticket', async () => {
  const oldRead = deferred<any>(); mocks.load.mockReturnValueOnce(oldRead.promise);
  const view = render(<CoManagedTicketEditor resource={resource} onSaved={mocks.saved} onReload={mocks.reload} />);
  const next = { ...resource, tenant: 'customer-b', relationshipId: 'relationship-b' };
  mocks.load.mockResolvedValue({ ...initial(), resource: next, values: { ...initial().values, title: 'Customer B' } });
  view.rerender(<CoManagedTicketEditor resource={next} onSaved={mocks.saved} onReload={mocks.reload} />);
  await screen.findByDisplayValue('Customer B'); await act(async () => oldRead.resolve(initial()));
  expect(screen.queryByDisplayValue('Original title')).toBeNull();
  const oldSave = deferred<any>(); mocks.save.mockReturnValueOnce(oldSave.promise);
  fireEvent.change(title(), { target: { value: 'B draft' } }); fireEvent.click(saveButton());
  view.rerender(<CoManagedTicketEditor resource={resource} onSaved={mocks.saved} onReload={mocks.reload} />);
  await act(async () => oldSave.resolve({ ok: true, receipt: {} }));
  expect(mocks.saved).not.toHaveBeenCalled();
});
it('pages and searches ticket-scoped choices while retaining the selected option label', async () => {
  mocks.search.mockImplementation(async (_resource, input) => input.field === 'status_id'
    ? { options: [{ id: input.afterId ? 'status-c' : 'status-b', name: input.afterId ? 'Resolved' : 'In progress' }], nextAfterId: input.afterId ? null : 'status-b' }
    : { options: [], nextAfterId: null });
  mount(); await screen.findByDisplayValue('Original title');
  await screen.findByRole('option', { name: 'In progress' });
  await waitFor(() => expect(screen.getByLabelText('coManaged.editor.fields.status_id')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('coManaged.editor.fields.status_id'), { target: { value: 'status-b' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.next' }));
  await waitFor(() => expect(mocks.search).toHaveBeenCalledWith(resource, { field: 'status_id', search: '', afterId: 'status-b' }));
  await waitFor(() => expect(screen.getByLabelText('coManaged.editor.fields.status_id')).not.toBeDisabled());
  expect(screen.getByRole('option', { name: 'In progress' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('coManaged.editor.searchOptions: coManaged.editor.fields.status_id'), { target: { value: 'New query' } });
  await waitFor(() => expect(mocks.search).toHaveBeenCalledWith(resource, { field: 'status_id', search: 'New query', afterId: undefined }));
});
