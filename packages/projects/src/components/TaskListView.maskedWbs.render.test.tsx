/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }) }));
vi.mock('next/dynamic', () => ({ default: () => (props: any) => <div data-testid="task-form-drawer"><span>{props.task.task_name}</span><span>{props.phase.phase_name}</span><span>{props.task.wbs_code ?? ''}</span></div> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.defaultValue ?? key }), useFormatters: () => ({ formatDate: () => '' }) }));
vi.mock('@alga-psa/ui/lib', () => ({ useCurrencyFormat: () => ({ money: () => '', symbol: () => '$' }) }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: () => null }));
vi.mock('@alga-psa/ui/components/PrintButton', () => ({ PrintButton: () => null, usePrintAction: () => vi.fn() }));
vi.mock('@alga-psa/ui/components/PrintOptionsDialog', () => ({ PrintOptionsDialog: () => null, usePrintColumnSelection: () => ({ selectedColumns: [], setSelectedColumns: vi.fn() }) }));
vi.mock('@alga-psa/ui/components/PrintableTable', () => ({ PrintableTable: () => null }));
vi.mock('@alga-psa/ui/components/PrintableDetailHeader', () => ({ PrintableDetailHeader: () => null }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <>{children}</>, AlertDescription: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/tickets/PrioritySelect', () => ({ PrioritySelect: () => null }));
vi.mock('@alga-psa/ui/components', () => ({ TagList: () => null }));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getUserAvatarUrlsBatchAction: async () => new Map() }));
vi.mock('@alga-psa/teams/actions', () => ({ getTeamAvatarUrlsBatchAction: async () => new Map() }));
vi.mock('../lib/useTaskTypeLabel', () => ({ useTaskTypeLabel: () => () => 'Task' }));
vi.mock('./TaskShareActionsContext', () => ({ useRegisterTaskShareActions: () => vi.fn() }));
vi.mock('./TaskSelectionContext', () => ({ useTaskSelection: () => ({ isSelected: () => false, toggleTask: vi.fn(), setTasksSelected: vi.fn(), selectedTaskIds: new Set() }) }));
vi.mock('./TaskStatusSelect', () => ({ TaskStatusSelect: () => null }));
vi.mock('./TaskTypeSelector', () => ({ TaskTypeSelector: () => null }));
vi.mock('../actions/projectActions', () => ({ getProjectTaskStatuses: async () => [] }));

import TaskListView from './TaskListView';
import TaskEdit from './TaskEdit';

afterEach(cleanup);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as any;

describe('TaskListView with masked WBS', () => {
  it('renders a masked task under its phase, selects it, and renders drawer content without WBS', async () => {
    const task = {
      tenant: 'tenant-1', task_id: 'task-1', phase_id: 'phase-1', task_name: 'List task with hidden WBS', description: null,
      assigned_to: null, estimated_hours: 0, actual_hours: 0, project_status_mapping_id: 'status-1', wbs_code: null,
      task_type_key: 'task', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'), start_date: null, due_date: null,
    } as unknown as IProjectTask;
    const phases = [
      { phase_id: 'phase-1', project_id: 'project-1', phase_name: 'Visible phase', wbs_code: null, order_key: 'a' },
      { phase_id: 'phase-2', project_id: 'project-1', phase_name: 'Other phase', wbs_code: null, order_key: 'b' },
    ] as unknown as IProjectPhase[];
    const status = { project_status_mapping_id: 'status-1', status_id: 'status-1', name: 'Open', custom_name: null, is_closed: false } as ProjectStatus;
    function TaskListAndDrawer() {
      const [selectedTask, setSelectedTask] = React.useState<IProjectTask | null>(null);
      return <>
        <TaskListView phases={phases} tasks={[task]} statuses={[status]}
          statusesByPhase={{ 'phase-1': [status], 'phase-2': [status] }} taskResources={{}} taskTags={{}}
          checklistItems={{}} users={[]} onTaskClick={setSelectedTask} onTaskDelete={vi.fn()} onTaskDuplicate={vi.fn()} />
        {selectedTask && <TaskEdit task={selectedTask} phase={phases[0]} phases={phases} projectStatuses={[]} users={[]} onClose={() => setSelectedTask(null)} onTaskUpdated={vi.fn()} />}
      </>;
    }

    const { container } = render(<TaskListAndDrawer />);

    const taskButton = await screen.findByRole('button', { name: 'List task with hidden WBS' });
    expect(screen.getByText('Visible phase')).toBeInTheDocument();
    expect(screen.getByText('Other phase')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'List task with hidden WBS' })).toHaveLength(1);
    expect(container.textContent).not.toContain('1.1');
    fireEvent.click(taskButton);
    const drawer = await screen.findByTestId('task-form-drawer');
    expect(drawer).toHaveTextContent('List task with hidden WBS');
    expect(drawer).toHaveTextContent('Visible phase');
    expect(drawer.textContent).not.toContain('1.1');
  });
});
