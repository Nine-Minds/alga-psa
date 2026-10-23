/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TaskForm from '../TaskForm';
import * as projectTaskActions from '../../actions/projectTaskActions';
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
  getTaskTypes: (...args: unknown[]) => getTaskTypesMock(...args)
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


vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  // The form renders a start-date and a due-date picker; tell them apart by id.
  DatePicker: ({ value, id, maxDate }: { value?: Date; id?: string; maxDate?: Date }) => (
    <input
      data-testid={id === 'task-start-date-picker' ? 'start-date' : 'due-date'}
      data-max-date={maxDate ? maxDate.toISOString() : ''}
      value={value ? value.toISOString() : ''}
      readOnly
    />
  )
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskForm start date, Created At and the dependency guard', () => {
  const phase = {
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

  const projectStatuses = [
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

  const users = [
    { user_id: 'user-1', first_name: 'Pat', last_name: 'Lee', email: 'pat@example.com', tenant: 'tenant-1' } as IUser
  ];

  const START = new Date('2026-10-05T00:00:00.000Z');
  const DUE = new Date('2026-10-09T00:00:00.000Z');
  const existingTask = {
    task_id: 'task-1',
    phase_id: 'phase-1',
    task_name: 'Existing Task',
    description: 'Existing description',
    assigned_to: 'user-1',
    estimated_hours: 120,
    actual_hours: null,
    project_status_mapping_id: 'status-1',
    created_at: new Date('2026-08-29T01:32:00.000Z'),
    updated_at: new Date(),
    wbs_code: '1',
    start_date: START,
    due_date: DUE,
    task_type_key: 'task',
    tenant: 'tenant-1'
  };

  let mockCtx: TicketIntegrationContextType;

  beforeEach(() => {
    mockCtx = createMockTicketIntegration();
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    getAllPrioritiesMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue({ services: [] });
    getTaskTypesMock.mockResolvedValue([]);
    getProjectDetailsMock.mockResolvedValue({ tasks: [] });
    vi.mocked(projectTaskActions.updateTaskWithChecklist).mockResolvedValue(existingTask as any);
    vi.mocked(projectTaskActions.getTaskChecklistItems).mockResolvedValue([] as any);
    vi.mocked(projectTaskActions.getTaskResourcesAction).mockResolvedValue([] as any);
    vi.mocked(projectTaskActions.getTaskDependencies).mockResolvedValue({ predecessors: [], successors: [] } as any);
  });

  function renderForm(props: Partial<React.ComponentProps<typeof TaskForm>> = {}) {
    return render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskForm
          task={existingTask as any}
          phase={phase}
          onClose={() => undefined}
          onSubmit={() => undefined}
          projectStatuses={projectStatuses}
          users={users}
          mode="edit"
          onPhaseChange={() => undefined}
          inDrawer={true}
          {...props}
        />
      </TicketIntegrationProvider>
    );
  }

  // The form keeps background work running (comments, lookups), so wait on the
  // outcome rather than on everything settling.
  function submit(container: HTMLElement) {
    fireEvent.submit(container.querySelector('form')!);
  }

  it('loads the task start date and caps it at the due date', () => {
    renderForm();
    expect(screen.getByTestId('start-date').getAttribute('value')).toBe(START.toISOString());
    expect(screen.getByTestId('due-date').getAttribute('value')).toBe(DUE.toISOString());
    // The start picker cannot go past the due date.
    expect(screen.getByTestId('start-date').getAttribute('data-max-date')).toBe(DUE.toISOString());
  });

  it('starts blank for a task with no start date, and for a new task', () => {
    renderForm({ task: { ...existingTask, start_date: null } as any });
    expect(screen.getByTestId('start-date').getAttribute('value')).toBe('');
    cleanup();
    renderForm({ task: undefined, mode: 'create' });
    expect(screen.getByTestId('start-date').getAttribute('value')).toBe('');
  });

  it('shows Created At as a caption when editing, outside the field grid, and not when creating', () => {
    const { container } = renderForm();
    const caption = container.querySelector('#task-created-at');
    expect(caption).not.toBeNull();
    expect(caption!.tagName).toBe('P');
    expect(caption!.className).toContain('col-span-2');
    // It is no longer a boxed pseudo-field.
    expect(caption!.className).not.toContain('border');
    cleanup();
    const created = renderForm({ task: undefined, mode: 'create' });
    expect(created.container.querySelector('#task-created-at')).toBeNull();
  });

  it('saves the start date with the task', async () => {
    const { container } = renderForm();
    submit(container);
    await vi.waitFor(() =>
      expect(projectTaskActions.updateTaskWithChecklist).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ start_date: START, due_date: DUE })
      )
    );
  });

  it('asks the dependency guard with the dates and status being saved, and saves when it agrees', async () => {
    const confirmBeforeSave = vi.fn().mockResolvedValue(true);
    const { container } = renderForm({ confirmBeforeSave });
    submit(container);
    await vi.waitFor(() => expect(projectTaskActions.updateTaskWithChecklist).toHaveBeenCalledTimes(1));
    expect(confirmBeforeSave).toHaveBeenCalledWith('task-1', {
      start_date: START,
      due_date: DUE,
      project_status_mapping_id: 'status-1'
    });
    // The guard is asked first.
    expect(confirmBeforeSave.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(projectTaskActions.updateTaskWithChecklist).mock.invocationCallOrder[0]
    );
  });

  it('does not save, and keeps the form open, when the guard is declined', async () => {
    const confirmBeforeSave = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { container } = renderForm({ confirmBeforeSave, onClose, onSubmit });
    submit(container);
    await vi.waitFor(() => expect(confirmBeforeSave).toHaveBeenCalledTimes(1));
    // Give a wrongly-continuing save the chance to happen before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(projectTaskActions.updateTaskWithChecklist).not.toHaveBeenCalled();
    expect(projectTaskActions.moveTaskToPhase).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The form is usable again rather than stuck in its submitting state.
    expect(container.querySelector('form')).not.toBeNull();
  });
});
