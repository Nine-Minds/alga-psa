/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

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

let prefillPayload: any = null;

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

vi.mock('../PrefillFromTicketDialog', () => ({
  __esModule: true,
  default: ({ open, onPrefill }: any) =>
    open ? (
      <div>
        <div data-testid="prefill-dialog" />
        <button type="button" onClick={() => onPrefill(prefillPayload)}>
          Confirm Prefill
        </button>
      </div>
    ) : null
}));

describe('TaskForm create-from-ticket flow', () => {
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
    prefillPayload = null;
  });

  it('shows create-from-ticket icon in create mode', () => {
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

    expect(document.querySelector('#task-create-from-ticket')).toBeTruthy();
  });

  it('does not show create-from-ticket icon in edit mode', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskForm
          task={{
            task_id: 'task-1',
            phase_id: 'phase-1',
            task_name: 'Existing Task',
            description: null,
            assigned_to: null,
            estimated_hours: null,
            actual_hours: null,
            project_status_mapping_id: 'status-1',
            created_at: new Date(),
            updated_at: new Date(),
            wbs_code: '1',
            due_date: null,
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

    expect(document.querySelector('#task-create-from-ticket')).toBeNull();
  });

  it('opens PrefillFromTicketDialog when icon is clicked', () => {
    prefillPayload = {
      prefillData: {
        task_name: 'Prefilled Task',
        description: 'Prefilled description',
        assigned_to: 'user-1',
        due_date: new Date('2026-02-05T00:00:00.000Z'),
        estimated_hours: 1.5
      },
      ticket: {
        ticket_id: 'ticket-1',
        ticket_number: 'T-001',
        title: 'Prefilled Task',
        status_name: 'Open',
        is_closed: false
      },
      shouldLink: true
    };

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

    fireEvent.click(document.querySelector('#task-create-from-ticket') as HTMLElement);
    expect(screen.getByTestId('prefill-dialog')).toBeInTheDocument();
  });

  it('populates form fields after prefill confirm', async () => {
    prefillPayload = {
      prefillData: {
        task_name: 'Prefilled Task',
        description: 'Prefilled description',
        assigned_to: 'user-1',
        due_date: new Date('2026-02-05T00:00:00.000Z'),
        estimated_hours: 1.5
      },
      ticket: {
        ticket_id: 'ticket-1',
        ticket_number: 'T-001',
        title: 'Prefilled Task',
        status_name: 'Open',
        is_closed: false
      },
      shouldLink: true
    };

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

    fireEvent.click(document.querySelector('#task-create-from-ticket') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Prefill' }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter task name...')).toHaveValue('Prefilled Task');
    });
    expect(screen.getByPlaceholderText('Add task description...')).toHaveValue('Prefilled description');
  });

  it('adds pending ticket link when auto-link is on', async () => {
    prefillPayload = {
      prefillData: {
        task_name: 'Prefilled Task',
        description: 'Prefilled description',
        assigned_to: 'user-1',
        due_date: new Date('2026-02-05T00:00:00.000Z'),
        estimated_hours: 1.5
      },
      ticket: {
        ticket_id: 'ticket-1',
        ticket_number: 'T-001',
        title: 'Prefilled Task',
        status_name: 'Open',
        is_closed: false
      },
      shouldLink: true
    };

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

    fireEvent.click(document.querySelector('#task-create-from-ticket') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Prefill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addTaskToPhaseMock).toHaveBeenCalled());
    expect(addTicketLinkActionMock).toHaveBeenCalledWith('project-1', 'task-1', 'ticket-1', 'phase-1');
  });

  it('does not add ticket link when auto-link is off', async () => {
    prefillPayload = {
      prefillData: {
        task_name: 'Prefilled Task',
        description: 'Prefilled description',
        assigned_to: 'user-1',
        due_date: new Date('2026-02-05T00:00:00.000Z'),
        estimated_hours: 1.5
      },
      ticket: {
        ticket_id: 'ticket-1',
        ticket_number: 'T-001',
        title: 'Prefilled Task',
        status_name: 'Open',
        is_closed: false
      },
      shouldLink: false
    };

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

    fireEvent.click(document.querySelector('#task-create-from-ticket') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Prefill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addTaskToPhaseMock).toHaveBeenCalled());
    expect(addTicketLinkActionMock).not.toHaveBeenCalled();
  });

  it('E2E: prefill from ticket and save links ticket', async () => {
    prefillPayload = {
      prefillData: {
        task_name: 'Prefilled Task',
        description: 'Prefilled description',
        assigned_to: 'user-1',
        due_date: new Date('2026-02-05T00:00:00.000Z'),
        estimated_hours: 1.5
      },
      ticket: {
        ticket_id: 'ticket-1',
        ticket_number: 'T-001',
        title: 'Prefilled Task',
        status_name: 'Open',
        is_closed: false
      },
      shouldLink: true
    };

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

    fireEvent.click(document.querySelector('#task-create-from-ticket') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Prefill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addTicketLinkActionMock).toHaveBeenCalled());
  });
});
