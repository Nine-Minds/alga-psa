/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedProjectTaskQueue from '../../../components/co-managed/CoManagedProjectTaskQueue';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedProjectTaskActions', () => ({ getSharedProjectTaskQueueAction: mocks.load }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, vars?: any) => vars ? `${key}:${JSON.stringify(vars)}` : key }),
  useFormatters: () => ({ formatDate: () => 'Formatted date' }), useOptionalI18n: () => null }));
const page = () => ({ page: 1, pageSize: 25, totalCount: 51, openCount: 50, closedCount: 1, canOversight: true,
  workspaces: [{ tenant: 'msp', name: 'MSP' }, { tenant: 'customer', name: 'Customer IT' }],
  items: [{ tenant: 'msp', relationshipId: null, projectId: 'native-project', taskId: 'same-id', workspaceName: 'MSP', fields: { task_name: 'Local task', project_name: 'Native project' } },
    { tenant: 'customer', relationshipId: 'relationship', projectId: 'customer-project', taskId: 'same-id', workspaceName: 'Customer IT', fields: { task_name: 'Shared task' } }] });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedProjectTaskQueue /></CoManagedFeatureBoundary>);
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.load.mockResolvedValue(page()); });
afterEach(cleanup);
it.each([{ enabled: false }, { enabled: true, loading: true }, { enabled: true, error: new Error('unavailable') }])('does not fetch the task queue with an unavailable release flag: %j', flag => {
  mocks.flag.mockReturnValue(flag); mount(); expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole('link')).toBeNull();
});
it('opens native and shared tasks with distinct qualified links and server pagination', async () => {
  mount(); expect(await screen.findByRole('link', { name: 'Local task' })).toHaveAttribute('href', '/msp/projects/native-project/tasks/same-id');
  expect(screen.getByRole('link', { name: 'Shared task' })).toHaveAttribute('href', '/msp/co-management/tasks/customer/relationship/same-id');
  expect(screen.getByText('coManaged.projects.queue.counts:{"total":51,"open":50,"closed":1}')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.next' }));
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 25 })));
});
it('sends task search, assignment, workspace and sort filters to the server', async () => {
  mount(); await screen.findByRole('link', { name: 'Shared task' });
  fireEvent.change(screen.getByLabelText('coManaged.queue.workspace'), { target: { value: 'customer' } });
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceTenant: 'customer', page: 1 })));
  fireEvent.change(screen.getByLabelText('coManaged.projects.queue.assignment'), { target: { value: 'my_teams' } });
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ assignment: 'my_teams' })));
  fireEvent.change(screen.getByLabelText('coManaged.queue.sort'), { target: { value: 'due' } });
  fireEvent.change(screen.getByLabelText('coManaged.queue.search'), { target: { value: 'Literal 100%' } }); fireEvent.click(screen.getByRole('button', { name: 'coManaged.queue.search' }));
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'due', search: 'Literal 100%', page: 1 })));
  fireEvent.change(screen.getByLabelText('coManaged.queue.view'), { target: { value: 'oversight' } });
  await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'oversight', workspaceTenant: undefined })));
});
it('shows the customer task workspace without MSP oversight controls', async () => {
  mocks.load.mockResolvedValue({ ...page(), canOversight: false, items: [page().items[1]] }); mount(); await screen.findByRole('link', { name: 'Shared task' });
  expect(screen.queryByLabelText('coManaged.queue.view')).toBeNull(); expect(screen.getByText('coManaged.projects.queue.customerDescription')).toBeInTheDocument();
});
it('ignores stale task queue responses and clears data after a failed refresh', async () => {
  let finish!: (value: any) => void; mocks.load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); mount();
  fireEvent.change(screen.getByLabelText('coManaged.projects.queue.assignment'), { target: { value: 'mine' } }); await screen.findByRole('link', { name: 'Shared task' });
  await act(async () => finish({ ...page(), items: [{ ...page().items[0], fields: { task_name: 'Stale task' } }] })); expect(screen.queryByText('Stale task')).toBeNull();
  mocks.load.mockRejectedValue(new Error('revoked')); fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.refresh' }));
  await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByText(/coManaged.projects.queue.counts:/)).toBeNull();
});
