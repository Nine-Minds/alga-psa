/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PhaseQuickAdd from '../PhaseQuickAdd';
import ProjectQuickAdd from '../ProjectQuickAdd';

const addProjectPhaseMock = vi.fn();
const createProjectMock = vi.fn();
const getServicesMock = vi.fn();

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

const HOURLY_SERVICE = {
  service_id: '11111111-1111-1111-1111-111111111111',
  service_name: 'Emerald City Support',
  billing_method: 'hourly',
};

// A fixed-price service can never back a time entry, so it must not be offered
// as a default anywhere (see timeEntryServiceChoices).
const FIXED_SERVICE = {
  service_id: '22222222-2222-2222-2222-222222222222',
  service_name: 'Emerald City Security',
  billing_method: 'fixed',
};

beforeEach(() => {
  vi.clearAllMocks();
  getServicesMock.mockResolvedValue({
    services: [HOURLY_SERVICE, FIXED_SERVICE],
    totalCount: 2,
    page: 1,
    pageSize: 999,
  });
  addProjectPhaseMock.mockResolvedValue({ phase_id: 'phase-1', project_id: 'project-1' });
  createProjectMock.mockResolvedValue({ project_id: 'project-1', tags: [] });
});

afterEach(() => {
  cleanup();
});

describe('PhaseQuickAdd default service', () => {
  it('offers only time-entry-eligible services and saves the chosen one', async () => {
    render(
      <PhaseQuickAdd
        projectId="project-1"
        onClose={() => undefined}
        onPhaseAdded={() => undefined}
        onCancel={() => undefined}
      />
    );

    const select = await screen.findByTestId('phase-quick-add-service-select');
    await waitFor(() => {
      expect(select).toHaveTextContent(HOURLY_SERVICE.service_name);
    });
    expect(select).not.toHaveTextContent(FIXED_SERVICE.service_name);

    fireEvent.change(
      screen.getByPlaceholderText('Phase name... *'),
      { target: { value: 'Yellow Brick Road' } }
    );
    fireEvent.change(select, { target: { value: HOURLY_SERVICE.service_id } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addProjectPhaseMock).toHaveBeenCalled());
    expect(addProjectPhaseMock.mock.calls[0][0]).toMatchObject({
      phase_name: 'Yellow Brick Road',
      service_id: HOURLY_SERVICE.service_id,
    });
  });

  it('sends no service when none is picked', async () => {
    render(
      <PhaseQuickAdd
        projectId="project-1"
        onClose={() => undefined}
        onPhaseAdded={() => undefined}
        onCancel={() => undefined}
      />
    );

    await screen.findByTestId('phase-quick-add-service-select');
    fireEvent.change(
      screen.getByPlaceholderText('Phase name... *'),
      { target: { value: 'Poppy Field' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addProjectPhaseMock).toHaveBeenCalled());
    expect(addProjectPhaseMock.mock.calls[0][0].service_id).toBeNull();
  });
});

describe('ProjectQuickAdd default service', () => {
  it('offers only time-entry-eligible services and creates the project with it', async () => {
    render(
      <ProjectQuickAdd
        onClose={() => undefined}
        onProjectAdded={() => undefined}
        clients={[]}
      />
    );

    const select = await screen.findByTestId('project-quick-add-service-select');
    await waitFor(() => {
      expect(select).toHaveTextContent(HOURLY_SERVICE.service_name);
    });
    expect(select).not.toHaveTextContent(FIXED_SERVICE.service_name);

    fireEvent.change(
      screen.getByPlaceholderText('Project Name *'),
      { target: { value: 'Road to Oz' } }
    );
    fireEvent.click(screen.getByTestId('client-picker'));
    // The project status select is the dialog's only id-less CustomSelect.
    fireEvent.change(screen.getByTestId('unnamed-select'), { target: { value: 'status-1' } });
    fireEvent.click(screen.getByTestId('task-status-selector'));
    fireEvent.change(select, { target: { value: HOURLY_SERVICE.service_id } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => expect(createProjectMock).toHaveBeenCalled());
    expect(createProjectMock.mock.calls[0][0]).toMatchObject({
      project_name: 'Road to Oz',
      service_id: HOURLY_SERVICE.service_id,
    });
  });
});
