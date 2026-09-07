/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedProjectTaskEditor from '../../../components/co-managed/CoManagedProjectTaskEditor';
import CoManagedProjectTasks from '../../../components/co-managed/CoManagedProjectTasks';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), statuses: vi.fn(), save: vi.fn(), list: vi.fn(), history: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedProjectTaskActions', () => ({ getSharedProjectTaskEditorAction: mocks.load, getSharedProjectTaskStatusesAction: mocks.statuses,
  editSharedProjectTaskAction: mocks.save, listSharedProjectTasksAction: mocks.list, listSharedProjectTaskHistoryAction: mocks.history }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}><option value="">Choose</option>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useFormatters: () => ({ formatDate: () => 'date' }), useOptionalI18n: () => null }));
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'project_task' as const, id: 'task-a' };
const initial = () => ({ resource, values: { task_name: 'Verify rollout', due_date: null, project_status_mapping_id: 'status-a' }, editableFields: ['task_name', 'due_date', 'project_status_mapping_id'], selectedStatus: { id: 'status-a', name: 'Ready' }, organizationName: 'Customer A', projectName: 'Rollout', phaseName: 'Delivery' });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedProjectTaskEditor resource={resource} /></CoManagedFeatureBoundary>);
const name = () => screen.getByLabelText('coManaged.projects.name');
const save = () => screen.getByRole('button', { name: 'coManaged.policy.save' });
beforeEach(() => {
  vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.load.mockResolvedValue(initial());
  mocks.statuses.mockResolvedValue({ options: [], nextAfterId: null }); mocks.save.mockResolvedValue({ ok: true, receipt: { operationId: 'saved' } });
  mocks.history.mockResolvedValue({ items: [], nextBeforeId: null });
  mocks.list.mockResolvedValue({ items: [initial()], nextAfterId: null });
});
afterEach(cleanup);
it.each([{ enabled: false }, { enabled: true, loading: true }, { enabled: true, error: new Error('unavailable') }])('does not load shared project UI with an unavailable release flag: %j', flag => {
  mocks.flag.mockReturnValue(flag); mount(); render(<CoManagedFeatureBoundary><CoManagedProjectTasks resource={{ ...resource, kind: 'project' }} /></CoManagedFeatureBoundary>);
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});
it('edits only changed task fields with a baseline and qualified identity', async () => {
  mount(); await screen.findByDisplayValue('Verify rollout'); expect(save()).toBeDisabled(); expect(screen.getByText('Customer A · Rollout · Delivery')).toBeInTheDocument();
  fireEvent.change(name(), { target: { value: 'Verified' } }); fireEvent.click(save());
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save).toHaveBeenCalledWith(resource, { operationId: expect.any(String), expected: { task_name: 'Verify rollout' }, patch: { task_name: 'Verified' } });
});
it('retries an uncertain task save with the same operation and frozen values', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, code: 'unknownOutcome' }); mount(); await screen.findByDisplayValue('Verify rollout');
  fireEvent.change(name(), { target: { value: 'Retry this' } }); fireEvent.click(save());
  await screen.findByRole('alert'); expect(name()).toBeDisabled(); const request = structuredClone(mocks.save.mock.calls[0]);
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.retry' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(mocks.save.mock.calls[1]).toEqual(request);
});
it('requires a reload on conflict and removes fields after access denial', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, code: 'conflict' }); mount(); await screen.findByDisplayValue('Verify rollout');
  fireEvent.change(name(), { target: { value: 'Concurrent edit' } }); fireEvent.click(save()); await screen.findByRole('alert');
  expect(name()).toBeDisabled(); expect(save()).toBeDisabled(); fireEvent.click(document.getElementById('co-project-task-reload')!);
  await waitFor(() => expect(name()).toBeEnabled()); mocks.save.mockResolvedValueOnce({ ok: false, code: 'forbidden' });
  fireEvent.change(name(), { target: { value: 'Denied edit' } }); fireEvent.click(save()); await screen.findByRole('alert');
  await waitFor(() => expect(screen.queryByLabelText('coManaged.projects.name')).toBeNull());
});
it('uses owner-qualified task links and clears page contents when access is revoked', async () => {
  render(<CoManagedProjectTasks resource={{ ...resource, kind: 'project', id: 'project-a' }} />);
  expect(await screen.findByRole('link', { name: 'Verify rollout' })).toHaveAttribute('href', '/msp/co-management/tasks/customer-a/relationship-a/task-a');
  mocks.list.mockRejectedValue(new Error('revoked')); fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.reload' }));
  await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('does not show a late task response after navigating to another customer', async () => {
  let finish!: (value: any) => void; mocks.load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = mount(); const second = { ...resource, tenant: 'customer-b', id: 'task-b' }; mocks.load.mockResolvedValue({ ...initial(), resource: second, values: { task_name: 'Customer B task' }, editableFields: [] });
  view.rerender(<CoManagedFeatureBoundary><CoManagedProjectTaskEditor resource={second} /></CoManagedFeatureBoundary>);
  await screen.findByDisplayValue('Customer B task'); await act(async () => finish(initial()));
  expect(screen.queryByDisplayValue('Verify rollout')).toBeNull();
});

it('shows immutable task history and reloads it after a successful edit', async () => {
  mocks.history.mockResolvedValue({ items: [{ id: 'audit-a', occurredAt: '2026-09-07T12:00:00.000Z', author: { displayName: 'Technician', organizationName: 'Service provider' },
    changes: [{ field: 'project_status_mapping_id', value: 'status-old', statusName: 'Verified at the time' }] }], nextBeforeId: null });
  mount(); expect(await screen.findByText('Technician · Service provider')).toBeInTheDocument(); expect(screen.getByText('Verified at the time')).toBeInTheDocument();
  expect(screen.queryByText('status-old')).toBeNull();
  fireEvent.change(name(), { target: { value: 'Saved with history' } }); fireEvent.click(save());
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2));
});
it('clears task fields and history when a history page loses current authority', async () => {
  mocks.history.mockResolvedValueOnce({ items: [{ id: 'audit-a', changes: [{ field: 'task_name', value: 'Earlier title' }] }], nextBeforeId: 'audit-a' }).mockRejectedValueOnce(new Error('revoked'));
  mount(); await screen.findByText('Earlier title'); fireEvent.click(document.getElementById('co-project-task-history-older')!);
  await screen.findByRole('alert'); expect(screen.queryByText('Earlier title')).toBeNull(); expect(screen.queryByDisplayValue('Verify rollout')).toBeNull();
  expect(mocks.history).toHaveBeenLastCalledWith(resource, 'audit-a');
});
it('ignores a delayed history denial from the previous customer', async () => {
  let deny!: (reason: any) => void; mocks.history.mockReturnValueOnce(new Promise((_, reject) => { deny = reject; }));
  const view = mount(); await screen.findByDisplayValue('Verify rollout'); await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(1));
  const second = { ...resource, tenant: 'customer-b', id: 'task-b' };
  mocks.load.mockResolvedValue({ ...initial(), resource: second, values: { task_name: 'Customer B task' }, editableFields: [] });
  view.rerender(<CoManagedFeatureBoundary><CoManagedProjectTaskEditor resource={second} /></CoManagedFeatureBoundary>);
  await screen.findByDisplayValue('Customer B task'); await act(async () => deny(new Error('revoked previous customer')));
  expect(screen.getByDisplayValue('Customer B task')).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull();
});
