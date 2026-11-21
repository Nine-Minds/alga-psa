/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import TaskForm from '../TaskForm';
import { fireEvent, waitFor, screen as rtlScreen } from '@testing-library/react';
import { ProjectDataSourceProvider } from '../../context/ProjectDataSourceContext';
import { nativeProjectDataSource } from '../../lib/nativeProjectDataSource';
import { NATIVE_PROJECT_SCREEN, type ProjectDataSource } from '../../lib/projectDataSource';
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
const getProjectTreeDataMock = vi.fn();

let lastTaskTicketLinksProps: any = null;
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: toastErrorMock, success: vi.fn(), dismiss: vi.fn(), loading: vi.fn() });
  return { default: toast, toast, Toaster: () => null };
});


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
  TextEditor: ({ initialContent, placeholder, editable = true }: { initialContent?: Array<{ content?: Array<{ text?: string }> }>; placeholder?: string; editable?: boolean }) => {
    const text = (initialContent ?? [])
      .map((b) => (Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join('') : ''))
      .join('\n');
    return (
      <>
        <textarea readOnly placeholder={placeholder} value={text} />
        <div className="ProseMirror" contentEditable={editable} suppressContentEditableWarning tabIndex={editable ? 0 : undefined}>{text}</div>
      </>
    );
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
  getTaskDependencies: vi.fn().mockResolvedValue({ predecessors: [], successors: [] }),
  addTaskDependency: vi.fn(),
  getTaskTypes: (...args: unknown[]) => getTaskTypesMock(...args)
}));

vi.mock('../../actions/projectActions', () => ({
  getProjectDetails: (...args: unknown[]) => getProjectDetailsMock(...args),
  getProjectTreeData: (...args: unknown[]) => getProjectTreeDataMock(...args)
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const phase = { phase_id: 'phase-1', project_id: 'project-1', phase_name: 'Phase 1', wbs_code: '1', tenant: 't' } as IProjectPhase;
const statuses = [{ project_status_mapping_id: 'status-1', name: 'Open', custom_name: null, is_closed: false, is_visible: true, display_order: 1, project_id: 'project-1', status_id: 'status-1', is_standard: false } as ProjectStatus];
const task = {
  task_id: 'task-1', phase_id: 'phase-1', task_name: 'Existing', description: 'd', assigned_to: null, estimated_hours: 120, actual_hours: null,
  project_status_mapping_id: 'status-1', created_at: new Date(), updated_at: new Date(), wbs_code: '1', start_date: null, due_date: null, task_type_key: 'task', tenant: 't',
} as never;

const resolvingTree = () => vi.fn().mockResolvedValue([{ value: 'project-1', label: 'Project 1', type: 'project', children: [] }]);
/** A native source whose tree resolves, so no native mount in this file can reject (and toast) after its test ends. */
const nativeSource = (tree = resolvingTree()): ProjectDataSource =>
  ({ ...nativeProjectDataSource, options: { ...nativeProjectDataSource.options, tree } }) as ProjectDataSource;

const sharedSource = (editTask: ProjectDataSource['editTask'], screenOver: Partial<ProjectDataSource['screen']> = {}): ProjectDataSource => ({
  ...nativeProjectDataSource,
  kind: 'co-managed-shared',
  editTask,
  screen: { ...NATIVE_PROJECT_SCREEN, admittedTaskEdit: true, hideCreate: true, hidePhaseMoves: true, frozenFields: ['start_date'], hiddenFields: ['priority_id'], ...screenOver },
} as ProjectDataSource);

const mount = (source: ProjectDataSource) => render(
  <ProjectDataSourceProvider dataSource={source}>
    <TicketIntegrationProvider value={createMockTicketIntegration()}>
      <TaskForm task={task} phase={phase} onClose={() => undefined} onSubmit={() => undefined} projectStatuses={statuses}
        users={[] as IUser[]} mode="edit" onPhaseChange={() => undefined} inDrawer={true} />
    </TicketIntegrationProvider>
  </ProjectDataSourceProvider>,
);

describe('TaskForm in shared mode', () => {
  beforeEach(() => {
    getCurrentUserMock.mockResolvedValue({ user_id: 'u' });
    getAllPrioritiesMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue({ services: [] });
    getTaskTypesMock.mockResolvedValue([]);
    getProjectDetailsMock.mockResolvedValue({ tasks: [] });
    // A valid tree, so a native mount left pending by an earlier test can never toast into a later one.
    getProjectTreeDataMock.mockResolvedValue([{ value: 'project-1', label: 'Project 1', type: 'project', children: [] }]);
  });

  it('renders a frozen field disabled and does not render a hidden field', () => {
    const { container } = mount(sharedSource(vi.fn()));
    const frozen = container.querySelector('[data-frozen-field="start_date"]') as HTMLFieldSetElement | null;
    expect(frozen).not.toBeNull();
    expect(frozen!.disabled).toBe(true);
    expect(container.querySelector('[data-frozen-field="estimated_hours"]')).toBeNull();
    expect(container.querySelector('#task-priority-select, [id*="priority"]')).toBeNull();
    expect(container.querySelector('#task-form-readonly-note')).not.toBeNull();
  });

  it('shows the refused-fields alert and sends the non-admitted field to editTask, never dropping it', async () => {
    const editTask = vi.fn().mockResolvedValue({ ok: false, code: 'refused', refusedFields: ['estimated_hours'] });
    const { container } = mount(sharedSource(editTask));
    fireEvent.change(container.querySelector('#task-estimated-hours-input') as HTMLInputElement, { target: { value: '5' } });
    fireEvent.submit(container.querySelector('#task-form') as HTMLFormElement);
    await waitFor(() => expect(container.querySelector('#task-form-refused-fields')).not.toBeNull());
    expect(editTask).toHaveBeenCalledTimes(1);
    expect(editTask.mock.calls[0][0].taskId).toBe('task-1');
    expect(editTask.mock.calls[0][0].changes).toHaveProperty('estimated_hours', 300);
  });

  it('does not take the admitted path under the default native source', async () => {
    const { container } = render(
      <ProjectDataSourceProvider dataSource={nativeSource()}>
<TicketIntegrationProvider value={createMockTicketIntegration()}>
        <TaskForm task={task} phase={phase} onClose={() => undefined} onSubmit={() => undefined} projectStatuses={statuses}
          users={[] as IUser[]} mode="edit" onPhaseChange={() => undefined} inDrawer={true} />
      </TicketIntegrationProvider>
</ProjectDataSourceProvider>);
    expect(container.querySelector('[data-frozen-field]')).toBeNull();
    expect(container.querySelector('#task-form-readonly-note')).toBeNull();
  });

  describe('drawer controls that are not admitted', () => {
    const notAdmitted = { frozenFields: ['task_type_key', 'assigned_to', 'start_date'], hiddenFields: [] as string[] };

    it('renders the task type read-only text, not an empty "Select task type" select', async () => {
      getTaskTypesMock.mockResolvedValue([{ type_key: 'task', type_name: 'Task', color: null }]);
      const { container } = mount(sharedSource(vi.fn(), notAdmitted));
      await waitFor(() => expect(container.querySelector('#task-type-readonly')!.textContent).toBe('Task'));
      expect(container.textContent).not.toContain('Select task type');
    });

    it('keeps the native task type select under the native source', () => {
      const { container } = render(
        <ProjectDataSourceProvider dataSource={nativeSource()}>
<TicketIntegrationProvider value={createMockTicketIntegration()}>
          <TaskForm task={task} phase={phase} onClose={() => undefined} onSubmit={() => undefined} projectStatuses={statuses}
            users={[] as IUser[]} mode="edit" onPhaseChange={() => undefined} inDrawer={true} />
        </TicketIntegrationProvider>
</ProjectDataSourceProvider>);
      expect(container.querySelector('#task-type-readonly')).toBeNull();
    });

    it('does not render the native assignee picker, so it cannot contradict the aside', () => {
      const { container } = mount(sharedSource(vi.fn(), notAdmitted));
      expect(rtlScreen.queryByTestId('assigned-user')).toBeNull();
      expect(container.textContent).not.toContain('Not assigned');
    });

    it('still shows the native assignee picker under the native source', () => {
      render(
        <ProjectDataSourceProvider dataSource={nativeSource()}>
<TicketIntegrationProvider value={createMockTicketIntegration()}>
          <TaskForm task={task} phase={phase} onClose={() => undefined} onSubmit={() => undefined} projectStatuses={statuses}
            users={[] as IUser[]} mode="edit" onPhaseChange={() => undefined} inDrawer={true} />
        </TicketIntegrationProvider>
</ProjectDataSourceProvider>);
      expect(rtlScreen.queryByTestId('assigned-user')).not.toBeNull();
    });
  });

  describe('project tree fetch', () => {
    it('does not fetch the tree, toast or console.error when the phase moves are hidden (shared drawer open)', async () => {
      const tree = vi.fn().mockResolvedValue([]);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      toastErrorMock.mockClear();
      const source = sharedSource(vi.fn(), { hidePhaseMoves: true });
      mount({ ...source, options: { ...source.options, tree } } as ProjectDataSource);
      await act(async () => { await Promise.resolve(); });
      expect(tree).not.toHaveBeenCalled();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls).toEqual([]);
      errorSpy.mockRestore();
    });

    it('native mode still fetches the tree', async () => {
      const tree = vi.fn().mockResolvedValue([{ value: 'p', label: 'P', type: 'project', children: [] }]);
      const source = nativeSource(tree);
      render(
        <ProjectDataSourceProvider dataSource={source}>
          <TicketIntegrationProvider value={createMockTicketIntegration()}>
            <TaskForm task={task} phase={phase} onClose={() => undefined} onSubmit={() => undefined} projectStatuses={statuses}
              users={[] as IUser[]} mode="edit" onPhaseChange={() => undefined} inDrawer={true} />
          </TicketIntegrationProvider>
        </ProjectDataSourceProvider>);
      await waitFor(() => expect(tree).toHaveBeenCalledTimes(1));
    });
  });

  it('read-only screen renders no Update button and every field frozen', () => {
    const { container } = mount(sharedSource(vi.fn(), { readOnly: true, admittedTaskEdit: false }));
    expect(container.querySelector('#save-button')).toBeNull();
  });

  describe('frozen rich-text description', () => {
    const editorOf = (c: HTMLElement) => c.querySelector('[data-frozen-field="description"] .ProseMirror, .ProseMirror') as HTMLElement;

    it('is not editable when the description is frozen (collaborate)', () => {
      const { container } = mount(sharedSource(vi.fn(), { frozenFields: ['description'], hiddenFields: [] }));
      const gate = container.querySelector('[data-frozen-field="description"]') as HTMLElement;
      expect(gate).not.toBeNull();
      const pm = gate.querySelector('.ProseMirror') as HTMLElement;
      expect(pm.getAttribute('contenteditable')).toBe('false');
      expect(pm.tabIndex).toBe(-1);
    });

    it('is not editable on a readOnly source, and shows the view-only note', () => {
      const { container } = mount(sharedSource(vi.fn(), { readOnly: true, admittedTaskEdit: false, frozenFields: [], hiddenFields: [] }));
      expect(editorOf(container).getAttribute('contenteditable')).toBe('false');
      expect(container.querySelector('#task-form-readonly-note')!.textContent).toBe('This project is view-only');
    });

    it('keeps the some-fields note when only some fields are frozen', () => {
      const { container } = mount(sharedSource(vi.fn()));
      expect(container.querySelector('#task-form-readonly-note')!.textContent).toBe('Some fields are read-only for shared work');
    });

    it('stays editable when the description is admitted', () => {
      const { container } = mount(sharedSource(vi.fn()));
      expect(container.querySelector('[data-frozen-field="description"]')).toBeNull();
      expect(editorOf(container).getAttribute('contenteditable')).toBe('true');
    });

    it('stays editable under the native source', () => {
      const { container } = render(
        <ProjectDataSourceProvider dataSource={nativeSource()}>
          <TicketIntegrationProvider value={createMockTicketIntegration()}>
            <TaskForm task={task} phase={phase} onClose={() => undefined} onSubmit={() => undefined} projectStatuses={statuses}
              users={[] as IUser[]} mode="edit" onPhaseChange={() => undefined} inDrawer={true} />
          </TicketIntegrationProvider>
        </ProjectDataSourceProvider>);
      expect(editorOf(container).getAttribute('contenteditable')).toBe('true');
    });
  });
});
