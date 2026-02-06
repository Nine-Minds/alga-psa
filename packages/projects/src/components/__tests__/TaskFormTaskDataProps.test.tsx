/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import TaskForm from '../TaskForm';
import type { IProjectPhase, ProjectStatus } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';
import { TicketIntegrationProvider, type TicketIntegrationContextType } from '../../context/TicketIntegrationContext';

function createMockTicketIntegration(
  overrides: Partial<TicketIntegrationContextType> = {}
): TicketIntegrationContextType {
  return {
    getTicketsForList: vi.fn().mockResolvedValue([]),
    getConsolidatedTicketData: vi.fn().mockResolvedValue({}),
    getTicketCategories: vi.fn().mockResolvedValue([]),
    getAllBoards: vi.fn().mockResolvedValue([]),
    openTicketInDrawer: vi.fn().mockResolvedValue(undefined),
    renderQuickAddTicket: vi.fn().mockReturnValue(null),
    renderCategoryPicker: vi.fn().mockReturnValue(null),
    renderPrioritySelect: vi.fn().mockReturnValue(null),
    deleteTicket: vi.fn(),
    ...overrides,
  };
}

const getCurrentUserMock = vi.fn();
const getAllPrioritiesMock = vi.fn();
const getServicesMock = vi.fn();
const getTaskTypesMock = vi.fn();
const getProjectDetailsMock = vi.fn();

let lastTaskTicketLinksProps: any = null;

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: () => getCurrentUserMock(),
  getUserAvatarUrlsBatchAction: vi.fn()
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAllPriorities: (...args: unknown[]) => getAllPrioritiesMock(...args)
}));

vi.mock('@alga-psa/projects/actions/serviceCatalogActions', () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args)
}));

vi.mock('../actions/projectTaskActions', () => ({
  updateTaskWithChecklist: vi.fn(),
  addTaskToPhase: vi.fn(),
  getTaskChecklistItems: vi.fn(),
  moveTaskToPhase: vi.fn(),
  deleteTask: vi.fn(),
  addTaskResourceAction: vi.fn(),
  removeTaskResourceAction: vi.fn(),
  getTaskResourcesAction: vi.fn(),
  addTicketLinkAction: vi.fn(),
  duplicateTaskToPhase: vi.fn(),
  getTaskDependencies: vi.fn(),
  addTaskDependency: vi.fn(),
  getTaskTypes: (...args: unknown[]) => getTaskTypesMock(...args)
}));

vi.mock('../actions/projectActions', () => ({
  getProjectDetails: (...args: unknown[]) => getProjectDetailsMock(...args),
  getProjectTreeData: vi.fn()
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() })
}));

vi.mock('../TaskTicketLinks', () => ({
  __esModule: true,
  default: (props: any) => {
    lastTaskTicketLinksProps = props;
    return <div data-testid="task-ticket-links" />;
  }
}));

describe('TaskForm taskData prop', () => {
  const phase: IProjectPhase = {
    phase_id: 'phase-1',
    project_id: 'project-1',
    phase_name: 'Phase 1',
    description: null,
    start_date: null,
    end_date: null,
    status: 'open',
    order_number: 1,
    created_at: new Date(),
    updated_at: new Date(),
    wbs_code: '1',
    tenant: 'tenant-1'
  } as IProjectPhase;

  const projectStatuses: ProjectStatus[] = [
    {
      project_status_mapping_id: 'status-1',
      name: 'Open',
      custom_name: null,
      is_closed: false,
      is_visible: true,
      is_standard: true,
      display_order: 1,
      project_id: 'project-1',
      status_id: 'status-1'
    } as ProjectStatus
  ];

  const users: IUser[] = [
    {
      user_id: 'user-1',
      first_name: 'Pat',
      last_name: 'Lee',
      email: 'pat@example.com',
      tenant: 'tenant-1'
    } as IUser
  ];

  let mockCtx: TicketIntegrationContextType;

  beforeEach(() => {
    mockCtx = createMockTicketIntegration();
    lastTaskTicketLinksProps = null;
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    getAllPrioritiesMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue({ services: [] });
    getTaskTypesMock.mockResolvedValue([]);
    getProjectDetailsMock.mockResolvedValue({ tasks: [] });
  });

  it('passes taskData to TaskTicketLinks in edit mode', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskForm
          task={{
            task_id: 'task-1',
            phase_id: 'phase-1',
            task_name: 'Existing Task',
            description: 'Existing description',
            assigned_to: 'user-1',
            estimated_hours: 120,
            actual_hours: null,
            project_status_mapping_id: 'status-1',
            created_at: new Date(),
            updated_at: new Date(),
            wbs_code: '1',
            due_date: new Date('2026-02-05T00:00:00.000Z'),
            task_type_key: 'task',
            tenant: 'tenant-1'
          }}
          phase={phase}
          onClose={() => undefined}
          onSubmit={() => undefined}
          projectStatuses={projectStatuses}
          users={users}
          mode="edit"
          onPhaseChange={() => undefined}
          inDrawer={true}
        />
      </TicketIntegrationProvider>
    );

    expect(lastTaskTicketLinksProps.taskData).toBeDefined();
    expect(lastTaskTicketLinksProps.taskData.task_name).toBe('Existing Task');
  });

  it('does not pass taskData to TaskTicketLinks in create mode', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskForm
          phase={phase}
          onClose={() => undefined}
          onSubmit={() => undefined}
          projectStatuses={projectStatuses}
          users={users}
          mode="create"
          onPhaseChange={() => undefined}
          inDrawer={true}
        />
      </TicketIntegrationProvider>
    );

    expect(lastTaskTicketLinksProps.taskData).toBeUndefined();
  });
});
