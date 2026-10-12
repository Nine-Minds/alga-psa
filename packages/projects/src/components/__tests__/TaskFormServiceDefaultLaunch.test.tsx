/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TaskForm from '../TaskForm';
import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';
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
const getEffectiveTaskServiceMock = vi.fn();
const launchTimeEntryMock = vi.fn();

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    renderDocuments: () => null,
    renderDocumentUpload: () => null,
    renderDocumentSelector: () => null,
    renderFolderSelectorModal: () => null,
    renderDocumentStorageCard: () => null,
    downloadDocument: vi.fn().mockResolvedValue(undefined),
    getDocumentDownloadUrl: vi.fn().mockResolvedValue(''),
    getDocumentsByEntity: vi.fn().mockResolvedValue({ documents: [] }),
    getDocumentCountsForEntities: vi.fn().mockResolvedValue({}),
    getDocumentsByContractId: vi.fn().mockResolvedValue([]),
    getDocumentByTicketId: vi.fn().mockResolvedValue(null),
    getImageUrl: vi.fn().mockResolvedValue(null),
    createDocumentAssociations: vi.fn().mockResolvedValue(undefined),
    removeDocumentAssociations: vi.fn().mockResolvedValue(undefined),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    updateDocument: vi.fn().mockResolvedValue(undefined),
    getBlockContent: vi.fn().mockResolvedValue(null),
    updateBlockContent: vi.fn().mockResolvedValue(undefined),
    downloadDocumentInBrowser: vi.fn().mockResolvedValue(undefined),
    uploadDocument: vi.fn().mockResolvedValue(undefined),
    createBlockDocument: vi.fn().mockResolvedValue({ document_id: 'doc-1', content_id: 'content-1' }),
    ensureEntityFolders: vi.fn().mockResolvedValue(undefined),
  }),
  DocumentsCrossFeatureProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: ({ placeholder }: { placeholder?: string }) => <textarea readOnly placeholder={placeholder} />,
  RichTextViewer: () => null,
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => null,
  TagManager: () => null,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="assigned-user" data-value={value} />,
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue([]),
  isTeamActionError: () => false,
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityId: vi.fn().mockResolvedValue([]),
  createTagsForEntity: vi.fn().mockResolvedValue([]),
  isTagActionError: () => false,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: () => getCurrentUserMock(),
  getUserAvatarUrlsBatchAction: vi.fn(),
  getCurrentUserAvatarUrl: vi.fn().mockResolvedValue(null),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAllPriorities: (...args: unknown[]) => getAllPrioritiesMock(...args),
}));

vi.mock('@alga-psa/projects/actions/serviceCatalogActions', () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args),
}));

vi.mock('../../actions/projectTaskActions', () => ({
  addTaskToPhase: vi.fn(),
  updateTaskWithChecklist: vi.fn(),
  getTaskChecklistItems: vi.fn().mockResolvedValue([]),
  moveTaskToPhase: vi.fn(),
  deleteTask: vi.fn(),
  addTaskResourceAction: vi.fn(),
  addTaskResourcesAction: vi.fn(),
  removeTaskResourceAction: vi.fn(),
  getTaskResourcesAction: vi.fn().mockResolvedValue([]),
  addTicketLinkAction: vi.fn(),
  duplicateTaskToPhase: vi.fn(),
  getTaskDependencies: vi.fn().mockResolvedValue({ predecessors: [], successors: [] }),
  addTaskDependency: vi.fn(),
  getTaskTypes: (...args: unknown[]) => getTaskTypesMock(...args),
  getEffectiveTaskService: (...args: unknown[]) => getEffectiveTaskServiceMock(...args),
}));

vi.mock('../../actions/projectActions', () => ({
  getProjectDetails: (...args: unknown[]) => getProjectDetailsMock(...args),
  getProjectTreeData: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

vi.mock('@alga-psa/ui/context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSchedulingCallbacks: () => ({ launchTimeEntry: launchTimeEntryMock }),
  };
});

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false, loading: false, error: null }),
}));

vi.mock('../TaskTicketLinks', () => ({
  __esModule: true,
  default: () => <div data-testid="task-ticket-links" />,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ value }: { value?: Date }) => (
    <input data-testid="due-date" value={value ? value.toISOString() : ''} readOnly />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskForm time entry default service', () => {
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
    tenant: 'tenant-1',
  } as IProjectPhase;

  const task: IProjectTask = {
    task_id: 'task-1',
    phase_id: 'phase-1',
    task_name: 'Existing Task',
    description: '',
    assigned_to: 'user-1',
    estimated_hours: 0,
    actual_hours: null,
    project_status_mapping_id: 'status-1',
    created_at: new Date(),
    updated_at: new Date(),
    wbs_code: '1',
    due_date: null,
    task_type_key: 'task',
    service_id: null,
    tenant: 'tenant-1',
  } as unknown as IProjectTask;

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
      status_id: 'status-1',
    } as ProjectStatus,
  ];

  const users: IUser[] = [
    { user_id: 'user-1', first_name: 'Pat', last_name: 'Lee', email: 'pat@example.com', tenant: 'tenant-1' } as IUser,
  ];

  const projectDefault = {
    serviceId: null,
    serviceName: null,
    billingMethod: null,
    source: null,
    inherited: {
      serviceId: 'service-project',
      serviceName: 'Basic Support',
      billingMethod: 'hourly',
      source: 'project' as const,
    },
  };

  let mockCtx: TicketIntegrationContextType;

  const renderForm = () =>
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskForm
          task={task}
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

  beforeEach(() => {
    mockCtx = createMockTicketIntegration();
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    getAllPrioritiesMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue({ services: [] });
    getTaskTypesMock.mockResolvedValue([]);
    getProjectDetailsMock.mockResolvedValue({ tasks: [] });
    getEffectiveTaskServiceMock.mockResolvedValue(projectDefault);
    launchTimeEntryMock.mockResolvedValue(undefined);
  });

  it('carries the project default into an entry launched before the hint loads', async () => {
    // The form resolves its inheritance hint in the background. A click that
    // beats that fetch must still open the entry with the project default, so
    // the resolution happens on click rather than reading loaded state.
    let releaseHintLoad: (() => void) | undefined;
    getEffectiveTaskServiceMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseHintLoad = () => resolve(projectDefault);
      })
    );

    renderForm();

    const addEntry = await screen.findByRole('button', { name: /add time entry/i });
    fireEvent.click(addEntry);

    await waitFor(() => expect(launchTimeEntryMock).toHaveBeenCalledTimes(1));
    const { context } = launchTimeEntryMock.mock.calls[0][0];
    expect(context.serviceId).toBe('service-project');
    expect(context.serviceName).toBe('Basic Support');
    expect(context.serviceSource).toBe('project');

    releaseHintLoad?.();
  });

  it('keeps the phase default ahead of the project one', async () => {
    getEffectiveTaskServiceMock.mockResolvedValue({
      ...projectDefault,
      inherited: {
        serviceId: 'service-phase',
        serviceName: 'Premium Support',
        billingMethod: 'hourly',
        source: 'phase' as const,
      },
    });

    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: /add time entry/i }));

    await waitFor(() => expect(launchTimeEntryMock).toHaveBeenCalledTimes(1));
    const { context } = launchTimeEntryMock.mock.calls[0][0];
    expect(context.serviceId).toBe('service-phase');
    expect(context.serviceSource).toBe('phase');
  });

  it('launches without a default when the inherited service cannot take time', async () => {
    getEffectiveTaskServiceMock.mockResolvedValue({
      ...projectDefault,
      inherited: {
        serviceId: 'service-fixed',
        serviceName: 'Emerald City Security',
        billingMethod: 'fixed',
        source: 'project' as const,
      },
    });

    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: /add time entry/i }));

    await waitFor(() => expect(launchTimeEntryMock).toHaveBeenCalledTimes(1));
    const { context } = launchTimeEntryMock.mock.calls[0][0];
    expect(context.serviceId).toBeNull();
    expect(context.serviceSource).toBeUndefined();
  });
});
