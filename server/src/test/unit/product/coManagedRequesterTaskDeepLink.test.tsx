/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ phases: vi.fn(), tasks: vi.fn(), statuses: vi.fn(), shared: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', async () => ({ useCapability: (await import('../../../../../packages/ui/src/hooks/useCapability')).useCapability }));
vi.mock('@alga-psa/client-portal/actions', () => ({ getClientProjectPhases: mocks.phases, getClientProjectTasks: mocks.tasks, getClientProjectStatuses: mocks.statuses }));
vi.mock('@alga-psa/client-portal-composition', () => ({ ClientPortalProjectMetrics: () => null }));
vi.mock('@alga-psa/ui', () => ({ getDateFnsLocale: () => undefined }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({ default: ({ onChange }: any) => <><button onClick={() => onChange('list')}>List</button><button onClick={() => onChange('kanban')}>Kanban</button></> }));
vi.mock('../../../../../packages/client-portal/src/components/projects/ClientKanbanBoard', () => ({ default: ({ selectedPhaseId, onPhaseSelect }: any) => <><output aria-label="Selected phase">{selectedPhaseId}</output><button onClick={() => onPhaseSelect('first')}>First phase</button></> }));
vi.mock('../../../../../packages/client-portal/src/components/projects/ClientTaskListView', () => ({ default: () => null }));
vi.mock('../../../../../packages/client-portal/src/components/projects/ProjectBillingSummarySection', () => ({ default: () => null }));
import { FeatureFlagBootstrapProvider } from '../../../../../packages/ui/src/capability/bootstrapContext';
import { RequesterTaskConversationProvider } from '../../../../../packages/client-portal/src/components/projects/RequesterTaskConversation';
import ProjectDetailView from '../../../../../packages/client-portal/src/components/projects/ProjectDetailView';

const project = { project_id: 'project', project_name: 'Project', client_portal_config: { show_tasks: true, show_phases: true } } as any;
// A customer requester is SERVED (not admitted); the server's shared-work answer comes through the provider's loader.
const served = { 'capability:co-managed': true, 'capability:co-managed:admit': false };
const sponsor = { 'capability:co-managed': true, 'capability:co-managed:admit': true };
const Component = () => null;
const view = (flags?: Record<string, boolean>) => {
  const tree = <RequesterTaskConversationProvider component={Component} loadSharedTaskIds={mocks.shared}><ProjectDetailView project={project} /></RequesterTaskConversationProvider>;
  return flags ? <FeatureFlagBootstrapProvider initialFeatureFlags={flags}>{tree}</FeatureFlagBootstrapProvider> : tree;
};
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/client-portal/projects/project?taskId=target');
  mocks.phases.mockResolvedValue({ phases: [{ phase_id: 'first', phase_name: 'First' }, { phase_id: 'second', phase_name: 'Second' }] });
  mocks.tasks.mockResolvedValue({ tasks: [{ task_id: 'target', phase_id: 'second' }] }); mocks.statuses.mockResolvedValue({ statuses: [] }); mocks.shared.mockResolvedValue(['target']);
});
afterEach(cleanup);

it('selects the linked task phase once, even if the default phase arrives later, and preserves later navigation', async () => {
  let finish!: (value: any) => void;
  mocks.phases.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(view(served));
  await waitFor(() => expect(screen.getByLabelText('Selected phase')).toHaveTextContent('second'));
  await act(async () => finish({ phases: [{ phase_id: 'first', phase_name: 'First' }] }));
  expect(screen.getByLabelText('Selected phase')).toHaveTextContent('second');
  fireEvent.click(screen.getByRole('button', { name: 'First phase' }));
  fireEvent.click(screen.getByRole('button', { name: 'List' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kanban' }));
  await waitFor(() => expect(mocks.tasks.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first');
});
it('keeps the default phase when the linked task is unavailable', async () => {
  window.history.replaceState({}, '', '/client-portal/projects/project?taskId=unavailable');
  render(view(served));
  await waitFor(() => expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first'));
});
it.each([[undefined], [{ 'capability:co-managed': false }]])('ignores the link entirely when the capability does not serve (%j)', async flags => {
  render(view(flags as any));
  await waitFor(() => expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first'));
  await waitFor(() => expect(mocks.tasks).toHaveBeenCalled());
  expect(mocks.shared).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first');
});
it('ignores the link for a PSA sponsor (admitted) whose native project has no shared tasks', async () => {
  mocks.shared.mockResolvedValue([]);
  render(view(sponsor));
  await waitFor(() => expect(mocks.shared).toHaveBeenCalledWith('project'));
  await waitFor(() => expect(mocks.tasks).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first'));
  expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first');
});
it('ignores the link when the shared-work lookup fails', async () => {
  mocks.shared.mockRejectedValue(new Error('denied'));
  render(view(served));
  await waitFor(() => expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first'));
  await waitFor(() => expect(mocks.tasks).toHaveBeenCalled());
  expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first');
});
