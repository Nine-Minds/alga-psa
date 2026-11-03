/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { IProject, IProjectPhase, ProjectStatus } from '@alga-psa/types';

// Stable service/context values keep effects representative of the application.
const fixture = vi.hoisted(() => {
  const empty: any[] = [];
  const noop = () => {};
  const status = {
    project_status_mapping_id: 'status-1',
    status_id: 'status-1',
    name: 'Open',
    is_visible: true,
    is_closed: false,
  };
  const phases = ['Survey', 'Delivery'].map((phase_name, i) => ({
    tenant: 't1',
    project_id: 'project-1',
    phase_id: `phase-${i + 1}`,
    phase_name,
    description: null,
    wbs_code: null,
    order_key: i === 0 ? 'a' : 'b',
  }));
  const tasks = phases.map((phase, i) => ({
    tenant: 't1',
    task_id: `task-${i + 1}`,
    phase_id: phase.phase_id,
    task_name: i === 0 ? 'Survey task' : 'Delivery task',
    description: null,
    description_rich_text: null,
    assigned_to: null,
    assigned_team_id: null,
    wbs_code: null,
    project_status_mapping_id: 'status-1',
    order_key: 'a',
    estimated_hours: 0,
    actual_hours: 0,
    start_date: null,
    due_date: null,
    task_type_key: 'task',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  }));
  const tree = [
    {
      value: 'project-1',
      label: 'Masked project',
      type: 'project',
      children: [],
    },
  ];
  const data = {
    tasks,
    ticketLinks: {},
    taskResources: {},
    taskTags: {},
    checklistItems: {},
    taskDependencies: {},
  };
  const t = (key: string, fallback?: any) =>
    typeof fallback === 'string' ? fallback : (fallback?.defaultValue ?? key);
  const selection = {
    selectedTaskIds: new Set(),
    clearSelection: noop,
    setTasksSelected: noop,
    isSelected: () => false,
    toggleTask: noop,
  };
  const documents = { getDocumentCountsForEntities: async () => new Map() };
  const phaseStatuses = { 'phase-1': [status], 'phase-2': [status] };
  const getTasksForPhase = vi.fn(async () => data);
  return {
    empty,
    noop,
    t,
    selection,
    documents,
    tasks,
    phases,
    data,
    status,
    phaseStatuses,
    getTasksForPhase,
    tree,
    viewMode: 'kanban',
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fixture.t }) }));
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: fixture.noop, closeDrawer: fixture.noop }),
}));
vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
  useTruncationDetection: () => ({ ref: fixture.noop, isTruncated: false }),
}));
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: String }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: fixture.t }),
  useFormatters: () => ({ formatDate: () => '' }),
}));
vi.mock('@alga-psa/user-composition/hooks', () => {
  const prefs: Record<string, any> = {};
  return {
    useUserPreferencesBatch: (entries: any[]) => {
      for (const entry of entries)
        prefs[entry.key] ??= {
          value: entry.defaultValue,
          setValue: fixture.noop,
          isLoading: false,
        };
      prefs.project_detail_view_mode.value = fixture.viewMode;
      return prefs;
    },
  };
});
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => fixture.documents,
}));
vi.mock('@alga-psa/tags/context', () => ({
  useTags: () => ({ tags: fixture.empty }),
}));
vi.mock('@alga-psa/tags/hooks', () => ({ useTagPermissions: () => ({}) }));
vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityId: async () => fixture.empty,
  findTagsByEntityIds: async () => fixture.empty,
  isTagActionError: () => false,
}));
vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => null,
  QuickAddTagPicker: () => null,
}));
vi.mock('@alga-psa/auth/actions', () => ({
  checkCurrentUserPermissions: async () => fixture.empty,
}));
vi.mock('@alga-psa/reference-data/actions', () => ({
  getAllPriorities: async () => fixture.empty,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: async () => new Map(),
  getCurrentUser: async () => ({ user_id: 'user-1' }),
  searchUsersForMentions: async () => fixture.empty,
}));
vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: async () => fixture.empty,
  getTeamAvatarUrlsBatchAction: async () => new Map(),
  isTeamActionError: () => false,
}));
vi.mock('../context/ProjectBillingIntegrationContext', () => ({
  useProjectBillingIntegration: () => null,
}));
vi.mock('../lib/useTaskTypeLabel', () => ({
  useTaskTypeLabel: () => () => 'Task',
}));
vi.mock('../lib/projectUtils', () => ({
  calculateProjectCompletion: async () => ({
    taskCompletionPercentage: 0,
    hoursCompletionPercentage: 0,
    budgetedHours: 0,
    spentHours: 0,
    remainingHours: 0,
  }),
}));
vi.mock('../actions/projectTaskCommentActions', () => ({
  getTaskCommentCountsBatch: async () => ({}),
}));
vi.mock('../actions/projectTaskStatusActions', () => ({
  getPhaseCustomStatusCounts: async () => ({}),
}));
vi.mock('../actions/projectActions', () => ({
  getAuthorizedProjectTags: async () => fixture.empty,
  getAuthorizedProjectTagSuggestions: async () => fixture.empty,
  getProjectTaskStatuses: async () => [fixture.status],
  getProjectStatusesByPhase: async () => fixture.phaseStatuses,
  getProjectTreeData: async () => fixture.tree,
  getProjectDetails: async () => fixture.data,
}));
vi.mock('../actions/projectTaskActions', () => ({
  getTaskTypes: async () => fixture.empty,
  getProjectTaskData: async () => fixture.data,
  getTaskDependencies: async () => ({ predecessors: [], successors: [] }),
  getEffectiveTaskService: async () => ({ inherited: null }),
  getTaskChecklistItems: async () => fixture.empty,
  getTaskResourcesAction: async () => fixture.empty,
  getTasksForPhase: fixture.getTasksForPhase,
  getTaskById: async (id: string) =>
    fixture.tasks.find((task) => task.task_id === id),
}));
vi.mock('./TaskSelectionContext', () => ({
  useTaskSelection: () => fixture.selection,
}));
vi.mock('./useDependencyGuard', () => ({
  useDependencyGuard: () => ({
    confirmTaskChanges: async () => true,
    dependencyGuardDialog: null,
  }),
}));
// Phase navigation is a seam; the parent filtering and the entire board/card stack stay real.
vi.mock('./ProjectPhases', () => ({
  default: ({ phases, onPhaseSelect }: any) => (
    <nav aria-label="Phases">
      {phases.map((phase: any) => (
        <button key={phase.phase_id} onClick={() => onPhaseSelect(phase)}>
          {phase.phase_name}
        </button>
      ))}
    </nav>
  ),
}));
// Peripheral dialogs, pickers, printing, and cross-feature panels are isolated below.
// ProjectDetail, KanbanBoard, StatusColumn, TaskCard, TaskListView, TaskEdit, and TaskForm stay real.
vi.mock('./TaskQuickAdd', () => ({ default: () => null }));
vi.mock('./PhaseQuickAdd', () => ({ default: () => null }));
vi.mock('./DuplicateTaskDialog', () => ({ default: () => null }));
vi.mock('./MoveTaskDialog', () => ({ default: () => null }));
vi.mock('./BulkMoveTaskDialog', () => ({ default: () => null }));
vi.mock('./BulkAssignDialog', () => ({ default: () => null }));
vi.mock('./BulkAddTagsToTasksDialog', () => ({ default: () => null }));
vi.mock('./BulkTaskActionBar', () => ({ default: () => null }));
vi.mock('./PhaseTaskImportDialog', () => ({ default: () => null }));
vi.mock('./DonutChart', () => ({ default: () => null }));
vi.mock('./RemoveTeamDialog', () => ({ default: () => null }));
vi.mock('./ProjectGanttView', () => ({
  default: () => null,
  DEFAULT_GANTT_SETTINGS: {},
}));
vi.mock('./status-columns', () => ({ PhaseStatusScopeChip: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => null,
}));
vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({
  default: () => null,
}));
vi.mock('@alga-psa/ui/components/CollapseToggleButton', () => ({
  CollapseToggleButton: () => null,
}));
vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({
  default: () => null,
}));
vi.mock('@alga-psa/ui/components/ViewDensityControl', () => ({
  default: () => null,
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));
vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  default: () => null,
}));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/skeletons/KanbanBoardSkeleton', () => ({
  default: () => null,
}));
vi.mock('@alga-psa/ui/components', () => ({
  TagFilter: () => null,
  TagList: () => null,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, id, disabled }: any) => (
    <button id={id} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
vi.mock('@alga-psa/ui/components/Popover', () => ({
  Popover: ({ children }: any) => children,
  PopoverTrigger: ({ children }: any) => children,
  PopoverContent: () => null,
}));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => children,
  DropdownMenuTrigger: ({ children }: any) => children,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
}));

// Load the actual task form through React's lazy boundary, rather than replacing its content.
vi.mock('next/dynamic', async () => {
  const { lazy } = await import('react');
  return { default: (loader: any) => lazy(loader) };
});
vi.mock('@alga-psa/projects/actions/serviceCatalogActions', () => ({
  getServices: async () => ({ services: fixture.empty }),
}));
vi.mock('../context/TicketIntegrationContext', () => ({
  useTicketIntegration: () => ({
    renderPrioritySelect: () => null,
    deleteTicket: fixture.noop,
  }),
}));
vi.mock('@alga-psa/ui/context', () => ({
  useSchedulingCallbacks: () => ({ launchTimeEntry: fixture.noop }),
  useOptionalActivityCrossFeature: () => null,
}));
vi.mock('@alga-psa/ui/editor', () => ({ TextEditor: () => null }));
vi.mock('./TaskTicketLinks', () => ({ default: () => null }));
vi.mock('./TaskDependencies', () => ({ TaskDependencies: () => null }));
vi.mock('./TaskDocumentsSimple', () => ({ default: () => null }));
vi.mock('./TaskCredentialsSection', () => ({
  TaskCredentialsSection: () => null,
}));
vi.mock('./TaskCommentThread', () => ({ default: () => null }));
vi.mock('./PrefillFromTicketDialog', () => ({ default: () => null }));
vi.mock('./TaskTypeSelector', () => ({ TaskTypeSelector: () => null }));
vi.mock('./TaskStatusSelect', () => ({
  default: () => null,
  TaskStatusSelect: () => null,
}));
vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  SearchableSelect: () => null,
}));
vi.mock('@alga-psa/ui/components/TreeSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => null,
}));
vi.mock('@alga-psa/ui/components/PrintButton', () => ({
  PrintButton: () => null,
  usePrintAction: () => fixture.noop,
}));
vi.mock('@alga-psa/ui/components/PrintableDetailHeader', () => ({
  PrintableDetailHeader: () => null,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: any) =>
    isOpen ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => children,
}));

vi.mock('./TaskShareActionsContext', () => ({
  useRegisterTaskShareActions: () => fixture.noop,
}));
vi.mock('@alga-psa/ui/components/PrintOptionsDialog', () => ({
  PrintOptionsDialog: () => null,
  usePrintColumnSelection: () => ({
    selectedColumns: fixture.empty,
    setSelectedColumns: fixture.noop,
  }),
}));
vi.mock('@alga-psa/ui/components/PrintableTable', () => ({
  PrintableTable: () => null,
}));
vi.mock('@alga-psa/ui/components/tickets/PrioritySelect', () => ({
  PrioritySelect: () => null,
}));

import ProjectDetail from './ProjectDetail';

beforeEach(() => {
  fixture.viewMode = 'kanban';
  fixture.getTasksForPhase.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('renders only the selected phase tasks on the board when phase and task WBS are masked', async () => {
  render(
    <ProjectDetail
      project={
        {
          project_id: 'project-1',
          project_name: 'Masked project',
          tenant: 't1',
        } as IProject
      }
      phases={fixture.phases as unknown as IProjectPhase[]}
      statuses={[fixture.status] as ProjectStatus[]}
      users={[]}
      clients={[]}
    />,
  );

  // The phase response deliberately contains both phases' tasks: the parent must enforce membership.
  expect(await screen.findByText('Survey task')).toBeInTheDocument();
  expect(screen.queryByText('Delivery task')).not.toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Phases' })).getByRole(
      'button',
      { name: 'Delivery' },
    ),
  );
  expect(await screen.findByText('Delivery task')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText('Survey task')).not.toBeInTheDocument(),
  );
  expect(fixture.getTasksForPhase).toHaveBeenCalledWith('phase-2');
  expect(document.body.textContent).not.toContain('null.');
  fireEvent.click(screen.getByText('Delivery task'));
  const taskName = await screen.findByDisplayValue('Delivery task');
  fireEvent.change(taskName, { target: { value: 'Updated delivery task' } });
  expect(taskName).toHaveValue('Updated delivery task');
  expect(screen.queryByDisplayValue('Survey task')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('null.');
});

it('opens the actual task form from the project list with masked phase and task WBS', async () => {
  fixture.viewMode = 'list';
  render(
    <ProjectDetail
      project={
        {
          project_id: 'project-1',
          project_name: 'Masked project',
          tenant: 't1',
        } as IProject
      }
      phases={fixture.phases as unknown as IProjectPhase[]}
      statuses={[fixture.status] as ProjectStatus[]}
      users={[]}
      clients={[]}
    />,
  );

  const taskButton = await screen.findByRole('button', { name: 'Survey task' });
  expect(screen.getByText('Survey')).toBeInTheDocument();
  expect(screen.getByText('Delivery')).toBeInTheDocument();
  fireEvent.click(taskButton);
  const taskName = await screen.findByDisplayValue('Survey task');
  fireEvent.change(taskName, { target: { value: 'Updated survey task' } });
  expect(taskName).toHaveValue('Updated survey task');
  expect(screen.queryByDisplayValue('Delivery task')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('null.');
});
