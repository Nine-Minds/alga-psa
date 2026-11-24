/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import ProjectQuickAdd from '../ProjectQuickAdd';
import { ReferenceDataProvider, useReferenceLists } from '@alga-psa/ui/lib/referenceData';

const addProjectPhaseMock = vi.fn();
const createProjectMock = vi.fn();
const getServicesMock = vi.fn();
const loadMock = vi.fn();

/** No i18next instance under test, so resolve each call to its inline default. */
function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  return typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
}

// react-i18next's return value is both tuple and object; @alga-psa/ui's
// useTranslation wrapper destructures the tuple, so the stub must be both.
vi.mock('react-i18next', () => ({
  useTranslation: () => {
    const i18n = { isInitialized: true, language: 'en' };
    return Object.assign([translate, i18n, true], { t: translate, i18n, ready: true });
  },
}));

vi.mock('../../actions/projectActions', () => ({
  addProjectPhase: (...args: unknown[]) => addProjectPhaseMock(...args),
  createProject: (...args: unknown[]) => createProjectMock(...args),
  getProjectStatuses: () => Promise.resolve([
    { status_id: 'status-1', name: 'Open', is_closed: false },
  ]),
}));

vi.mock('../../actions/serviceCatalogActions', () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args),
}));

vi.mock('../../actions/projectTaskStatusActions', () => ({
  getTenantProjectStatuses: () => Promise.resolve([
    { status_id: 'task-status-1', name: 'To Do', is_closed: false },
  ]),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title, footer }: any) =>
    isOpen ? (
      <div>
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

function selectStub({ id, value, options, onChange, onValueChange }: any) {
  return (
    <select
      data-testid={id ?? 'unnamed-select'}
      value={value}
      onChange={(event) => (onChange ?? onValueChange)(event.target.value)}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  SearchableSelect: (props: any) => selectStub(props),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: (props: any) => selectStub(props),
}));

// Pickers that reach for server actions or context the service default does not need.
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, onSelect }: any) => (
    <button type="button" data-testid={id} onClick={() => onSelect('client-1')} />
  ),
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: () => null,
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsersBasic: () => Promise.resolve([]),
}));

vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: () => Promise.resolve([]),
}));

vi.mock('../ProjectTaskStatusSelector', () => ({
  ProjectTaskStatusSelector: ({ onChange }: any) => (
    <button
      type="button"
      data-testid="task-status-selector"
      onClick={() => onChange([{ status_id: 'task-status-1', display_order: 1 }])}
    />
  ),
}));

vi.mock('@alga-psa/tags/components/QuickAddTagPicker', () => ({
  QuickAddTagPicker: () => null,
}));

vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntity: () => Promise.resolve([]),
}));

vi.mock('@alga-psa/ui/components/QuickAddStatus', () => ({
  QuickAddStatus: () => null,
}));

vi.mock('@alga-psa/reference-data/actions/status-actions/statusActions', () => ({
  createStatus: vi.fn(),
}));

vi.mock('../ClientPortalConfigEditor', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../../context/ClientIntegrationContext', () => ({
  useClientIntegration: () => ({
    getContactsByClient: () => Promise.resolve([]),
    getAllContacts: () => Promise.resolve([]),
    renderQuickAddContact: () => null,
    renderQuickAddClient: () => null,
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));


/**
 * Reads the shared cache key the activities project filter reads (useActivityFilterOptions consumes
 * `projectsWithPhases` through the same hook). Kept to @alga-psa/ui so this package does not import
 * user-activities: that import made Nx infer projects -> user-activities, a cycle through
 * opportunities that broke `nx build-deps server`.
 */
function ActivitiesProjectFilter() {
  const { data, loading } = useReferenceLists(['projectsWithPhases']);
  return (
    <ul data-testid="activities-project-filter" data-loading={String(loading.projectsWithPhases)}>
      {(data.projectsWithPhases ?? []).map((p) => (
        <li key={p.project_id}>{p.project_name}</li>
      ))}
    </ul>
  );
}

function Shell({ cache, showFilter, showQuickAdd }: { cache: Map<unknown, unknown>; showFilter: boolean; showQuickAdd: boolean }) {
  return (
    <SWRConfig value={{ provider: () => cache as Map<string, never> }}>
      <ReferenceDataProvider load={loadMock} scope="tenant-1:user-1">
        {showFilter && <ActivitiesProjectFilter />}
        {showQuickAdd && <ProjectQuickAdd onClose={() => undefined} onProjectAdded={() => undefined} />}
      </ReferenceDataProvider>
    </SWRConfig>
  );
}

let serverProjects: Array<{ project_id: string; project_name: string; is_inactive: boolean; phases: [] }>;

beforeEach(() => {
  vi.clearAllMocks();
  getServicesMock.mockResolvedValue({ services: [], totalCount: 0, page: 1, pageSize: 999 });
  serverProjects = [{ project_id: 'p-old', project_name: 'Existing project', is_inactive: false, phases: [] }];
  loadMock.mockImplementation(async (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, key === 'projectsWithPhases' ? [...serverProjects] : []]))
  );
  createProjectMock.mockImplementation(async (data: { project_name: string }) => {
    serverProjects.push({ project_id: 'p-new', project_name: data.project_name, is_inactive: false, phases: [] });
    return { project_id: 'p-new', tags: [] };
  });
});
afterEach(cleanup);

async function createProjectThroughQuickAdd(name: string) {
  fireEvent.change(await screen.findByPlaceholderText('Project Name *'), { target: { value: name } });
  fireEvent.click(screen.getByTestId('client-picker'));
  fireEvent.change(screen.getByTestId('unnamed-select'), { target: { value: 'status-1' } });
  fireEvent.click(screen.getByTestId('task-status-selector'));
  fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
  await waitFor(() => expect(createProjectMock).toHaveBeenCalled());
}

describe('ProjectQuickAdd feeds the activities project filter', () => {
  it('shows a project created while the filter is mounted, after one projects-only refetch', async () => {
    const cache = new Map();
    render(<Shell cache={cache} showFilter showQuickAdd />);
    await waitFor(() => expect(screen.getByTestId('activities-project-filter')).toHaveTextContent('Existing project'));
    expect(loadMock).toHaveBeenCalledTimes(1);

    await createProjectThroughQuickAdd('Road to Oz');

    await waitFor(() => expect(screen.getByTestId('activities-project-filter')).toHaveTextContent('Road to Oz'));
    expect(screen.getByTestId('activities-project-filter')).toHaveTextContent('Existing project');
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(loadMock.mock.calls[1][0]).toEqual(['projectsWithPhases']);
  });

  it('shows a project created elsewhere when the user returns to the activities page, without a reload', async () => {
    const cache = new Map();
    // Visit the activities page first: warms the shared cache.
    const visit = render(<Shell cache={cache} showFilter showQuickAdd={false} />);
    await waitFor(() => expect(screen.getByTestId('activities-project-filter')).toHaveTextContent('Existing project'));
    visit.unmount();

    // Create a project on the projects page (filter not mounted).
    const projectsPage = render(<Shell cache={cache} showFilter={false} showQuickAdd />);
    await createProjectThroughQuickAdd('Yellow Brick Road');
    projectsPage.unmount();

    // Back to activities: the cached list renders at once, and the new project is there after the revalidation.
    render(<Shell cache={cache} showFilter showQuickAdd={false} />);
    await waitFor(() => expect(screen.getByTestId('activities-project-filter')).toHaveTextContent('Yellow Brick Road'));
  });
});
