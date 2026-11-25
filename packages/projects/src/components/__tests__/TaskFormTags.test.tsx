/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TaskForm from '../TaskForm';
import { ProjectDataSourceProvider } from '../../context/ProjectDataSourceContext';
import { nativeProjectDataSource } from '../../lib/nativeProjectDataSource';
import { NATIVE_PROJECT_SCREEN } from '../../lib/projectDataSource';
import { OPEN_PROJECT_SURFACE, projectDataSourceForSurface } from '../../lib/projectSurface';
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

const tagState = vi.hoisted(() => ({
  all: [] as any[],
  applied: [] as any[],
  perms: {} as Record<string, boolean>,
  context: () => ({
    tags: tagState.all,
    tagsLoaded: true,
    getPermissions: async () => tagState.perms,
    refetchTags: async () => undefined,
  }),
}));
const getCurrentUserMock = vi.fn();
const getAllPrioritiesMock = vi.fn();
const getServicesMock = vi.fn();
const getTaskTypesMock = vi.fn();
const getProjectDetailsMock = vi.fn();
const getEffectiveTaskServiceMock = vi.fn();
const launchTimeEntryMock = vi.fn();

// TaskForm takes useTranslation from react-i18next directly, and without an
// i18next instance the hook hands back a new t on every render. Its project
// tree effect is keyed on t, so the fallback branch would refetch forever.
const translate = (key: string, options?: string | { defaultValue?: string }) =>
  typeof options === 'string' ? options : options?.defaultValue ?? key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

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

// The real tag manager: what the dialog offers is decided by it, from the permissions and tags it is given.
vi.mock('@alga-psa/tags/components', async () => {
  const { TagManager } = await vi.importActual<Record<string, any>>('../../../../tags/src/components/TagManager');
  return { QuickAddTagPicker: () => null, TagManager };
});
vi.mock('../../../../tags/src/context/TagContext', () => ({ useTags: () => tagState.context() }));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: ({ value, disabled, teams, onTeamSelect }: { value: string; disabled?: boolean; teams?: unknown[]; onTeamSelect?: unknown }) => (
    <div data-testid="assigned-user" data-value={value} data-disabled={String(Boolean(disabled))}
      data-teams={String(teams?.length ?? 0)} data-team-select={String(typeof onTeamSelect === 'function')} />
  ),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue([]),
  isTeamActionError: () => false,
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityId: vi.fn(async () => tagState.applied),
  createTagsForEntity: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  getAllTags: vi.fn(async () => tagState.all),
  getTagMappingUsageCount: vi.fn(async () => ({ tagId: 'd', tagText: 'x', usageCount: 2 })),
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
  handleError: vi.fn(),
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

afterEach(async () => {
  // The form's initial-data effects keep resolving their mocked actions after
  // the assertion that ends each test. Drain them before unmounting so nothing
  // logs once the worker starts tearing the environment down.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup();
  vi.clearAllMocks();
});

/**
 * Alga-2026-0003430 (F002 / T003): the tags field of the task dialog. The screen says whether tags are writable (a seat
 * technician's surface leaves them open while the rest of the task is frozen; a read-only task freezes them), the
 * permissions say whether the caller applies existing tags only, and the tags the caller can see decide the picker.
 */
const SEAT_SURFACE = {
  closedFields: ['billing_profile_id', 'budgeted_hours', 'service_id'],
  closedOperations: ['project_billing', 'project_manage', 'project_materials', 'service_catalog'],
};
const EMPTY_MESSAGE = 'No project-task tags available';
const SEAT_PERMISSIONS = {
  canAddExisting: true, canCreateNew: false, canEditColors: false, canEditText: false, canDelete: true, canDeleteAll: false, canDeleteDefinition: false,
};
const definitionTag = (id: string, text: string, taggedId: string) =>
  ({ tag_id: id, tag_text: text, tagged_id: taggedId, tagged_type: 'project_task', tenant: 'tenant-1' });

describe('TaskForm tags on a seat technician\'s project surface', () => {
  const phase = { phase_id: 'phase-1', project_id: 'project-1', phase_name: 'Phase 1', status: 'open', order_number: 1, wbs_code: '1', tenant: 'tenant-1' } as unknown as IProjectPhase;
  const task = {
    task_id: 'task-1', phase_id: 'phase-1', task_name: 'Existing Task', description: '', assigned_to: 'user-1', estimated_hours: 0,
    project_status_mapping_id: 'status-1', wbs_code: '1', due_date: null, task_type_key: 'task', tenant: 'tenant-1',
    checklist_items: [], created_at: new Date(), updated_at: new Date(),
  } as unknown as IProjectTask;
  const statuses = [{
    project_status_mapping_id: 'status-1', name: 'Open', custom_name: null, is_closed: false, is_visible: true, is_standard: true,
    display_order: 1, project_id: 'project-1', status_id: 'status-1',
  }] as unknown as ProjectStatus[];
  const users = [{ user_id: 'user-1', first_name: 'Pat', last_name: 'Lee', email: 'pat@example.com', tenant: 'tenant-1' }] as unknown as IUser[];

  const renderForm = (source = projectDataSourceForSurface(nativeProjectDataSource, SEAT_SURFACE)) =>
    render(
      <ProjectDataSourceProvider dataSource={source}>
        <TicketIntegrationProvider value={createMockTicketIntegration()}>
          <TaskForm task={task} phase={phase} onClose={() => undefined} onSubmit={() => undefined} projectStatuses={statuses}
            users={users} mode="edit" onPhaseChange={() => undefined} inDrawer={true} />
        </TicketIntegrationProvider>
      </ProjectDataSourceProvider>
    );
  const picker = () => document.getElementById('task-tags-edit-input-button');

  beforeEach(() => {
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    getAllPrioritiesMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue({ services: [] });
    getTaskTypesMock.mockResolvedValue([]);
    getProjectDetailsMock.mockResolvedValue({ tasks: [] });
    getEffectiveTaskServiceMock.mockResolvedValue({ serviceId: null, serviceName: null, billingMethod: null, source: null,
      inherited: { serviceId: null, serviceName: null, billingMethod: null, source: null } });
    tagState.perms = SEAT_PERMISSIONS;
    tagState.all = [];
    tagState.applied = [];
  });

  it('leaves the tags field writable on the seat surface while the rest of the task stays frozen', async () => {
    const screen_ = projectDataSourceForSurface(nativeProjectDataSource, SEAT_SURFACE).screen;
    expect(screen_.frozenFields).toContain('task_name');
    expect(screen_.frozenFields).not.toContain('tags');
  });

  it('enables the picker when an eligible tag is available', async () => {
    tagState.all = [definitionTag('m1', 'urgent', 'task-9')];
    renderForm();
    await waitFor(() => expect(picker()).not.toBeNull());
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(document.querySelector('fieldset[data-frozen-field="tags"]')).toBeNull();
  });

  it('says so, and offers no picker, when the seat has no eligible project-task tags', async () => {
    renderForm();
    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(picker()).toBeNull();
  });

  it('keeps applied tags visible and removable when every eligible tag is already applied', async () => {
    const applied = definitionTag('m1', 'blocked', 'task-1');
    tagState.all = [applied];
    tagState.applied = [applied];
    renderForm();
    expect(await screen.findByText('blocked')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(picker()).toBeNull();
    expect(screen.getByRole('button', { name: /remove|delete|×|x/i, hidden: true })).toBeInTheDocument();
  });

  it('shows applied tags with no way to change them on a read-only task', async () => {
    const applied = definitionTag('m1', 'blocked', 'task-1');
    tagState.all = [applied, definitionTag('m2', 'urgent', 'task-9')];
    tagState.applied = [applied];
    const readOnly = Object.freeze({ ...nativeProjectDataSource, screen: Object.freeze({ ...NATIVE_PROJECT_SCREEN, readOnly: true }) }) as typeof nativeProjectDataSource;
    renderForm(readOnly);
    expect(await screen.findByText('blocked')).toBeInTheDocument();
    expect(picker()).toBeNull();
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(document.querySelector('fieldset[data-frozen-field="tags"]')?.querySelectorAll('button[id*="remove"], [aria-label*="emove"]').length ?? 0).toBe(0);
  });
});
