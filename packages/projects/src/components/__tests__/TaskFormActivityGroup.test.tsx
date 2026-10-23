/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { ActivityCrossFeatureProvider } from '@alga-psa/ui/context';
import { getTaskResourcesAction, getTaskChecklistItems, getTaskDependencies } from '../../actions/projectTaskActions';
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
  TextEditor: ({ initialContent, placeholder }: { initialContent?: Array<{ content?: Array<{ text?: string }> }>; placeholder?: string }) => {
    const text = (initialContent ?? [])
      .map((b) => (Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join('') : ''))
      .join('\n');
    return <textarea readOnly placeholder={placeholder} value={text} />;
  },
  RichTextViewer: () => null,
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => null,
  TagManager: () => null,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => (
    <div data-testid="assigned-user" data-value={value} />
  )
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
  searchUsersForMentions: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAllPriorities: (...args: unknown[]) => getAllPrioritiesMock(...args)
}));

vi.mock('@alga-psa/projects/actions/serviceCatalogActions', () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args)
}));

vi.mock('../../actions/projectTaskActions', () => ({
  updateTaskWithChecklist: vi.fn(),
  addTaskToPhase: vi.fn(),
  getTaskChecklistItems: vi.fn(),
  moveTaskToPhase: vi.fn(),
  deleteTask: vi.fn(),
  addTaskResourceAction: vi.fn(),
  addTaskResourcesAction: vi.fn(),
  removeTaskResourceAction: vi.fn(),
  getTaskResourcesAction: vi.fn(),
  addTicketLinkAction: vi.fn(),
  duplicateTaskToPhase: vi.fn(),
  getTaskDependencies: vi.fn(),
  addTaskDependency: vi.fn(),
  getTaskTypes: (...args: unknown[]) => getTaskTypesMock(...args),
  getEffectiveTaskService: vi.fn().mockResolvedValue({ inherited: null }),
}));

vi.mock('../../actions/projectActions', () => ({
  getProjectDetails: (...args: unknown[]) => getProjectDetailsMock(...args),
  getProjectTreeData: vi.fn()
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() })
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({
    enabled: false,
    loading: false,
    error: null,
  }),
}));

vi.mock('../TaskTicketLinks', () => ({
  __esModule: true,
  default: (props: any) => {
    lastTaskTicketLinksProps = props;
    return <div data-testid="task-ticket-links" />;
  }
}));

afterEach(() => {
  cleanup();
});

describe('TaskForm "My group" host', () => {
  const phase = {
    phase_id: 'phase-1', project_id: 'project-1', phase_name: 'Phase 1', description: null,
    start_date: null, end_date: null, status: 'open', order_number: 1,
    created_at: new Date(), updated_at: new Date(), wbs_code: '1', tenant: 'tenant-1',
  } as unknown as IProjectPhase;
  const projectStatuses = [{
    project_status_mapping_id: 'status-1', name: 'Open', custom_name: null, is_closed: false,
    is_visible: true, is_standard: true, display_order: 1, project_id: 'project-1', status_id: 'status-1',
  }] as unknown as ProjectStatus[];
  const users = [{ user_id: 'user-1', first_name: 'Pat', last_name: 'Lee', email: 'p@e.com', tenant: 'tenant-1' }] as unknown as IUser[];
  const task = {
    task_id: 'task-1', phase_id: 'phase-1', task_name: 'Existing Task', description: 'd', assigned_to: 'user-1',
    estimated_hours: 120, actual_hours: null, project_status_mapping_id: 'status-1',
    created_at: new Date(), updated_at: new Date(), wbs_code: '1', start_date: null, due_date: null,
    task_type_key: 'task', tenant: 'tenant-1',
  } as any;

  let mockCtx: TicketIntegrationContextType;
  const renderForm = (mode: 'edit' | 'create', crossFeature: any | null) => {
    const form = (
      <TicketIntegrationProvider value={mockCtx}>
        <TaskForm
          task={mode === 'edit' ? task : undefined}
          phase={phase}
          onClose={() => undefined}
          onSubmit={() => undefined}
          projectStatuses={projectStatuses}
          users={users}
          mode={mode}
          onPhaseChange={() => undefined}
          inDrawer={true}
        />
      </TicketIntegrationProvider>
    );
    return render(crossFeature ? <ActivityCrossFeatureProvider value={crossFeature}>{form}</ActivityCrossFeatureProvider> : form);
  };

  beforeEach(() => {
    mockCtx = createMockTicketIntegration();
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    getAllPrioritiesMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue({ services: [] });
    getTaskTypesMock.mockResolvedValue([]);
    getProjectDetailsMock.mockResolvedValue({ tasks: [] });
    vi.mocked(getTaskDependencies).mockResolvedValue({ predecessors: [], successors: [] } as any);
    vi.mocked(getTaskChecklistItems).mockResolvedValue([] as any);
    vi.mocked(getTaskResourcesAction).mockResolvedValue([{ assignment_id: 'a1', additional_user_id: 'user-b' }] as any);
  });

  it('renders and does not throw without a cross-feature provider (AlgaDesk)', () => {
    renderForm('edit', null);
    expect(screen.queryByTestId('group-control')).toBeNull();
    expect(screen.getByText('Task Name *')).toBeTruthy();
  });

  it('edit mode: renders the control in the task-name row with projectTask + task_id and saved-state key', async () => {
    const renderActivityGroupControl = vi.fn((p: any) => <span data-testid="group-control">{p.activityType}:{p.activityId}</span>);
    renderForm('edit', { renderActivityGroupControl });
    expect((await screen.findByTestId('group-control')).textContent).toBe('projectTask:task-1');
    expect(renderActivityGroupControl).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-form-activity-group', activityType: 'projectTask', activityId: 'task-1' })
    );
    // the key tracks the persisted primary assignee and, once loaded, additional agents
    await waitFor(() => {
      const keys = renderActivityGroupControl.mock.calls.map((c) => (c[0] as any).assignmentKey);
      expect(keys).toContain('user-1|user-b');
    });
    expect(screen.getByTestId('group-control').closest('div')!.textContent).toContain('Task Name *');
  });

  it('create mode: never renders the control (no task id yet)', () => {
    const renderActivityGroupControl = vi.fn(() => <span data-testid="group-control" />);
    renderForm('create', { renderActivityGroupControl });
    expect(renderActivityGroupControl).not.toHaveBeenCalled();
    expect(screen.queryByTestId('group-control')).toBeNull();
  });
});
