/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import CreateTaskFromTicketDialog from '../CreateTaskFromTicketDialog';
import { TicketIntegrationProvider, type TicketIntegrationContextType } from '../../context/TicketIntegrationContext';

const getProjectsMock = vi.fn();
const getProjectDetailsMock = vi.fn();
const openDrawerMock = vi.fn();

vi.mock('../../actions/projectActions', () => ({
  getProjects: (...args: unknown[]) => getProjectsMock(...args),
  getProjectDetails: (...args: unknown[]) => getProjectDetailsMock(...args)
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: openDrawerMock, closeDrawer: vi.fn() })
}));

vi.mock('../TaskQuickAdd', () => ({
  __esModule: true,
  default: () => <div data-testid="task-quick-add" />
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title, footer }: any) =>
    isOpen ? (
      <div>
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null
}));

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  SearchableSelect: ({ id, value, options, onChange, disabled }: any) => (
    <select
      data-testid={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="" />
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ checked, onChange, id, label }: any) => (
    <label>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
      {label}
    </label>
  )
}));

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

/** Dig the TaskQuickAdd element props out of the element passed to openDrawer. */
function getDrawerTaskQuickAddProps(): any {
  expect(openDrawerMock).toHaveBeenCalled();
  const drawerElement = openDrawerMock.mock.calls[openDrawerMock.mock.calls.length - 1][0];
  // openDrawer receives <TicketIntegrationProvider><TaskQuickAdd .../></TicketIntegrationProvider>
  return drawerElement.props.children.props;
}

afterEach(() => {
  cleanup();
});

describe('CreateTaskFromTicketDialog', () => {
  let mockCtx: TicketIntegrationContextType;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockTicketIntegration();
    getProjectsMock.mockResolvedValue([
      { project_id: 'project-2', project_name: 'Project Two', client_id: 'client-2' },
      { project_id: 'project-1', project_name: 'Project One', client_id: 'client-1' }
    ]);
    getProjectDetailsMock.mockResolvedValue({
      phases: [
        {
          phase_id: 'phase-1',
          phase_name: 'Phase One',
          project_id: 'project-1',
          description: null,
          start_date: null,
          end_date: null,
          status: 'open',
          order_number: 1,
          created_at: new Date(),
          updated_at: new Date(),
          wbs_code: '1',
          tenant: 'tenant-1'
        }
      ],
      statuses: [
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
        }
      ],
      users: []
    });
  });

  const ticket = {
    ticket_id: 'ticket-1',
    ticket_number: 'T-001',
    title: 'Printer issue',
    description: 'Paper jam',
    assigned_to: 'user-1',
    due_date: '2026-02-05T00:00:00.000Z',
    client_id: 'client-1'
  };

  function renderDialog() {
    return render(
      <TicketIntegrationProvider value={mockCtx}>
        <CreateTaskFromTicketDialog ticket={ticket} />
      </TicketIntegrationProvider>
    );
  }

  it('renders project selector with projects list', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(getProjectsMock).toHaveBeenCalled());

    const projectSelect = await screen.findByTestId('create-task-project');
    expect(projectSelect).toBeInTheDocument();
    await waitFor(() =>
      expect(projectSelect.querySelectorAll('option').length).toBeGreaterThan(1)
    );
  });

  it('sorts client-matching projects first', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(getProjectsMock).toHaveBeenCalled());
    await waitFor(() => {
      const options = Array.from(
        screen.getByTestId('create-task-project').querySelectorAll('option')
      );
      const values = options
        .map(option => option.getAttribute('value'))
        .filter(value => value);
      expect(values).toEqual(['project-1', 'project-2']);
    });
  });

  it('fetches phases and statuses when project is selected', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(getProjectsMock).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByTestId('create-task-project').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByTestId('create-task-project'), {
      target: { value: 'project-1' }
    });

    await waitFor(() => expect(getProjectDetailsMock).toHaveBeenCalledWith('project-1'));
  });

  it('populates phase selector from fetched phases', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(screen.getByTestId('create-task-project').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByTestId('create-task-project'), {
      target: { value: 'project-1' }
    });

    await waitFor(() => expect(screen.getByTestId('create-task-phase').querySelectorAll('option').length).toBeGreaterThan(1));
  });

  it('populates status selector from fetched statuses', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(screen.getByTestId('create-task-project').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByTestId('create-task-project'), {
      target: { value: 'project-1' }
    });

    await waitFor(() => expect(screen.getByTestId('create-task-status').querySelectorAll('option').length).toBeGreaterThan(1));
  });

  it('auto-link checkbox defaults to checked', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    const checkbox = screen.getByLabelText('Link ticket to the created task') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('opens TaskQuickAdd in drawer with mapped prefillData', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(screen.getByTestId('create-task-project').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByTestId('create-task-project'), { target: { value: 'project-1' } });

    await waitFor(() => expect(screen.getByTestId('create-task-phase').querySelectorAll('option').length).toBeGreaterThan(1));

    fireEvent.change(screen.getByTestId('create-task-phase'), { target: { value: 'phase-1' } });
    fireEvent.change(screen.getByTestId('create-task-status'), { target: { value: 'status-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(openDrawerMock).toHaveBeenCalled();
    expect(getDrawerTaskQuickAddProps().prefillData.task_name).toBe('Printer issue');
  });

  it('includes pendingTicketLink when auto-link is on', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(screen.getByTestId('create-task-project').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByTestId('create-task-project'), { target: { value: 'project-1' } });
    await waitFor(() => expect(screen.getByTestId('create-task-phase').querySelectorAll('option').length).toBeGreaterThan(1));

    fireEvent.change(screen.getByTestId('create-task-phase'), { target: { value: 'phase-1' } });
    fireEvent.change(screen.getByTestId('create-task-status'), { target: { value: 'status-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(getDrawerTaskQuickAddProps().prefillData.pendingTicketLink).toBeDefined();
  });

  it('omits pendingTicketLink when auto-link is off', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(screen.getByTestId('create-task-project').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByTestId('create-task-project'), { target: { value: 'project-1' } });
    await waitFor(() => expect(screen.getByTestId('create-task-phase').querySelectorAll('option').length).toBeGreaterThan(1));

    fireEvent.change(screen.getByTestId('create-task-phase'), { target: { value: 'phase-1' } });
    fireEvent.change(screen.getByTestId('create-task-status'), { target: { value: 'status-1' } });

    fireEvent.click(screen.getByLabelText('Link ticket to the created task'));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(getDrawerTaskQuickAddProps().prefillData.pendingTicketLink).toBeUndefined();
  });

  it('E2E: opens drawer with prefilled task on create', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(screen.getByTestId('create-task-project').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByTestId('create-task-project'), { target: { value: 'project-1' } });
    await waitFor(() => expect(screen.getByTestId('create-task-phase').querySelectorAll('option').length).toBeGreaterThan(1));

    fireEvent.change(screen.getByTestId('create-task-phase'), { target: { value: 'phase-1' } });
    fireEvent.change(screen.getByTestId('create-task-status'), { target: { value: 'status-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(openDrawerMock).toHaveBeenCalled();
  });
});
