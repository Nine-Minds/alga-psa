/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const addTaskToPhaseMock = vi.fn();
const addTicketLinkActionMock = vi.fn();

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
  addTaskToPhase: (...args: unknown[]) => addTaskToPhaseMock(...args),
  updateTaskWithChecklist: vi.fn(),
  getTaskChecklistItems: vi.fn(),
  moveTaskToPhase: vi.fn(),
  deleteTask: vi.fn(),
  addTaskResourceAction: vi.fn(),
  removeTaskResourceAction: vi.fn(),
  getTaskResourcesAction: vi.fn(),
  addTicketLinkAction: (...args: unknown[]) => addTicketLinkActionMock(...args),
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
  default: () => <div data-testid="task-ticket-links" />
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ value }: { value?: Date }) => (
    <input data-testid="due-date" value={value ? value.toISOString() : ''} readOnly />
  )
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => (
    <div data-testid="assigned-user" data-value={value} />
  )
}));

describe('TaskForm prefillData', () => {
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
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    getAllPrioritiesMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue({ services: [] });
    getTaskTypesMock.mockResolvedValue([]);
    getProjectDetailsMock.mockResolvedValue({ tasks: [] });
    addTaskToPhaseMock.mockResolvedValue({ task_id: 'task-1' });
    addTicketLinkActionMock.mockResolvedValue(undefined);
  });

  it('initializes task_name from prefillData', () => {
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
          prefillData={{
            task_name: 'Prefilled Task',
            description: '',
            assigned_to: null,
            due_date: null,
            estimated_hours: 0
          }}
        />
      </TicketIntegrationProvider>
    );

    const nameField = screen.getByPlaceholderText('Enter task name...') as HTMLTextAreaElement;
    expect(nameField.value).toBe('Prefilled Task');
  });

  it('initializes description from prefillData', () => {
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
          prefillData={{
            task_name: '',
            description: 'Prefilled description',
            assigned_to: null,
            due_date: null,
            estimated_hours: 0
          }}
        />
      </TicketIntegrationProvider>
    );

    const descriptionField = screen.getByPlaceholderText('Add task description...') as HTMLTextAreaElement;
    expect(descriptionField.value).toBe('Prefilled description');
  });

  it('initializes assigned_to from prefillData', () => {
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
          prefillData={{
            task_name: '',
            description: '',
            assigned_to: 'user-1',
            due_date: null,
            estimated_hours: 0
          }}
        />
      </TicketIntegrationProvider>
    );

    expect(screen.getByTestId('assigned-user')).toHaveAttribute('data-value', 'user-1');
  });

  it('initializes due_date from prefillData', () => {
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
          prefillData={{
            task_name: '',
            description: '',
            assigned_to: null,
            due_date: new Date('2026-02-05T10:00:00.000Z'),
            estimated_hours: 0
          }}
        />
      </TicketIntegrationProvider>
    );

    expect(screen.getByTestId('due-date')).toHaveValue('2026-02-05T10:00:00.000Z');
  });

  it('initializes estimated_hours from prefillData', () => {
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
          prefillData={{
            task_name: '',
            description: '',
            assigned_to: null,
            due_date: null,
            estimated_hours: 2.5
          }}
        />
      </TicketIntegrationProvider>
    );

    const spinbuttons = screen.getAllByRole('spinbutton');
    expect(spinbuttons[0]).toHaveValue(2.5);
  });

  it('initializes pendingTicketLinks from prefillData.pendingTicketLink', async () => {
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
          prefillData={{
            task_name: 'Prefilled Task',
            description: '',
            assigned_to: null,
            due_date: null,
            estimated_hours: 0,
            pendingTicketLink: {
              link_id: 'temp-1',
              task_id: 'temp',
              ticket_id: 'ticket-9',
              ticket_number: 'T-009',
              title: 'Prefilled ticket',
              created_at: new Date(),
              project_id: 'project-1',
              phase_id: 'phase-1',
              status_name: 'New',
              is_closed: false,
              tenant: 'tenant-1'
            }
          }}
        />
      </TicketIntegrationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addTaskToPhaseMock).toHaveBeenCalled());
    expect(addTicketLinkActionMock).toHaveBeenCalledWith('project-1', 'task-1', 'ticket-9', 'phase-1');
  });
});
