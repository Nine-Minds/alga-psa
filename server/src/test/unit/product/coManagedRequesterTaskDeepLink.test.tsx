/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ phases: vi.fn(), tasks: vi.fn(), statuses: vi.fn() }));
vi.mock('@alga-psa/client-portal/actions', () => ({ getClientProjectPhases: mocks.phases, getClientProjectTasks: mocks.tasks, getClientProjectStatuses: mocks.statuses }));
vi.mock('@alga-psa/client-portal-composition', () => ({ ClientPortalProjectMetrics: () => null }));
vi.mock('@alga-psa/ui', () => ({ getDateFnsLocale: () => undefined }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({ default: ({ onChange }: any) => <><button onClick={() => onChange('list')}>List</button><button onClick={() => onChange('kanban')}>Kanban</button></> }));
vi.mock('../../../../../packages/client-portal/src/components/projects/ClientKanbanBoard', () => ({ default: ({ selectedPhaseId, onPhaseSelect }: any) => <><output aria-label="Selected phase">{selectedPhaseId}</output><button onClick={() => onPhaseSelect('first')}>First phase</button></> }));
vi.mock('../../../../../packages/client-portal/src/components/projects/ClientTaskListView', () => ({ default: () => null }));
vi.mock('../../../../../packages/client-portal/src/components/projects/ProjectBillingSummarySection', () => ({ default: () => null }));
import ProjectDetailView from '../../../../../packages/client-portal/src/components/projects/ProjectDetailView';
const project = { project_id: 'project', project_name: 'Project', client_portal_config: { show_tasks: true, show_phases: true } } as any;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/client-portal/projects/project?taskId=target');
  mocks.phases.mockResolvedValue({ phases: [{ phase_id: 'first', phase_name: 'First' }, { phase_id: 'second', phase_name: 'Second' }] });
  mocks.tasks.mockResolvedValue({ tasks: [{ task_id: 'target', phase_id: 'second' }] }); mocks.statuses.mockResolvedValue({ statuses: [] });
});
afterEach(cleanup);
it('selects the email task phase once, even if the default phase arrives later, and preserves subsequent navigation', async () => {
  let finish!: (value: any) => void;
  mocks.phases.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<ProjectDetailView project={project} />);
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
  render(<ProjectDetailView project={project} />);
  await waitFor(() => expect(screen.getByLabelText('Selected phase')).toHaveTextContent('first'));
});
