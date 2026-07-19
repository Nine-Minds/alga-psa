/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BoardsSettings from './BoardsSettings';

const getAllBoardsMock = vi.fn();
const createBoardMock = vi.fn();
const updateBoardMock = vi.fn();
const getBoardTicketStatusesMock = vi.fn();
const getAllPrioritiesMock = vi.fn();
const getAllUsersMock = vi.fn();
const getSlaPoliciesMock = vi.fn();
const getTeamsMock = vi.fn();
const useFeatureFlagMock = vi.fn(() => ({ enabled: false }));

vi.mock('@alga-psa/tickets/actions', () => ({
  getAllBoards: (...args: unknown[]) => getAllBoardsMock(...args),
  getBoardListStats: () => Promise.resolve({}),
  createBoard: (...args: unknown[]) => createBoardMock(...args),
  getBoardTicketStatuses: (...args: unknown[]) => getBoardTicketStatusesMock(...args),
  updateBoard: (...args: unknown[]) => updateBoardMock(...args),
  deleteBoard: vi.fn(),
  getBoardCloseRules: () =>
    Promise.resolve({
      require_resolution_comment: false,
      require_time_entry: false,
      require_checklist_complete: false,
      require_no_open_children: false,
      required_fields: [],
      is_enabled: true,
    }),
  upsertBoardCloseRules: vi.fn(),
  getBoardAutoCloseRules: () => Promise.resolve([]),
  createBoardAutoCloseRule: vi.fn(),
  updateBoardAutoCloseRule: vi.fn(),
  deleteBoardAutoCloseRule: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/board-actions/boardActions', () => ({
  getAllBoards: (...args: unknown[]) => getAllBoardsMock(...args),
  getBoardListStats: () => Promise.resolve({}),
  createBoard: (...args: unknown[]) => createBoardMock(...args),
  updateBoard: (...args: unknown[]) => updateBoardMock(...args),
  deleteBoard: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/board-actions/boardTicketStatusActions', () => ({
  getBoardTicketStatuses: (...args: unknown[]) => getBoardTicketStatusesMock(...args),
}));

vi.mock('../../actions/close-rules/closeRuleActions', () => ({
  getBoardCloseRules: () =>
    Promise.resolve({
      require_resolution_comment: false,
      require_time_entry: false,
      require_checklist_complete: false,
      require_no_open_children: false,
      required_fields: [],
      is_enabled: true,
    }),
  upsertBoardCloseRules: vi.fn(),
  getBoardAutoCloseRules: () => Promise.resolve([]),
  createBoardAutoCloseRule: vi.fn(),
  updateBoardAutoCloseRule: vi.fn(),
  deleteBoardAutoCloseRule: vi.fn(),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAvailableReferenceData: vi.fn().mockResolvedValue([]),
  importReferenceData: vi.fn(),
  checkImportConflicts: vi.fn().mockResolvedValue([]),
  getAllPriorities: (...args: unknown[]) => getAllPrioritiesMock(...args),
}));

vi.mock('@alga-psa/reference-data/actions/referenceDataActions', () => ({
  getAvailableReferenceData: vi.fn().mockResolvedValue([]),
  importReferenceData: vi.fn(),
  checkImportConflicts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/reference-data/actions/priorityActions', () => ({
  getAllPriorities: (...args: unknown[]) => getAllPrioritiesMock(...args),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsers: (...args: unknown[]) => getAllUsersMock(...args),
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsers: (...args: unknown[]) => getAllUsersMock(...args),
}));

vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/sla/actions', () => ({
  getSlaPolicies: (...args: unknown[]) => getSlaPoliciesMock(...args),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: (...args: unknown[]) => getTeamsMock(...args),
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/teams/actions/team-actions/teamActions', () => ({
  getTeams: (...args: unknown[]) => getTeamsMock(...args),
}));

vi.mock('@alga-psa/teams/actions/team-actions/avatarActions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/teams/actions/team-actions/teamActionErrors', () => ({
  isTeamActionError: () => false,
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => useFeatureFlagMock(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (error: unknown) => {
    if (error && typeof error === 'object' && 'actionError' in error) return String((error as any).actionError);
    if (error && typeof error === 'object' && 'permissionError' in error) return String((error as any).permissionError);
    return error instanceof Error ? error.message : String(error);
  },
  handleError: vi.fn(),
  isActionMessageError: (value: unknown) => Boolean(value && typeof value === 'object' && 'actionError' in value),
  isActionPermissionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'permissionError' in value),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id: string }) => (
    <button {...props} data-testid={id}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input type="checkbox" {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui', () => ({
  DeleteEntityDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, id }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void; id?: string }) => (
    <input
      data-testid={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({
  __esModule: true,
  default: ({
    currentView,
    onChange,
    options,
  }: {
    currentView: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string; id?: string; disabled?: boolean }>;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-testid={option.id}
          data-value={option.value}
          aria-pressed={currentView === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    value,
    options,
    onValueChange,
    disabled,
  }: {
    id?: string;
    value?: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid={id}
      disabled={disabled}
      value={value || ''}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-team-picker" />,
}));

// The editor accordion opens with only the first (General) section expanded;
// every other section renders its body only once expanded, so tests must open
// the section they interact with.
const expandSection = (id: string) => {
  const toggle = document.getElementById(`board-editor-section-${id}`);
  if (toggle) {
    fireEvent.click(toggle);
  }
};

describe('BoardsSettings ticket status copy flow', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
    vi.clearAllMocks();
    useFeatureFlagMock.mockReturnValue({ enabled: false });
    getAllBoardsMock.mockResolvedValue([
      {
        board_id: 'board-source',
        board_name: 'Support',
        display_order: 10,
        is_inactive: false,
      },
      {
        board_id: 'board-other',
        board_name: 'Field Ops',
        display_order: 20,
        is_inactive: false,
      },
    ]);
    createBoardMock.mockResolvedValue({ board_id: 'board-new' });
    updateBoardMock.mockResolvedValue({ board_id: 'board-source' });
    getBoardTicketStatusesMock.mockResolvedValue([]);
    getAllPrioritiesMock.mockResolvedValue([]);
    getAllUsersMock.mockResolvedValue([]);
    getSlaPoliciesMock.mockResolvedValue([]);
    getTeamsMock.mockResolvedValue([]);
  });

  it('loads copied board statuses into the embedded editor and saves edited statuses', async () => {
    getBoardTicketStatusesMock.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-source') {
        return [
          {
            status_id: 'status-open',
            name: 'Support Open',
            is_closed: false,
            is_default: true,
            order_number: 10,
          },
          {
            status_id: 'status-closed',
            name: 'Support Closed',
            is_closed: true,
            is_default: false,
            order_number: 20,
          },
        ];
      }

      return [];
    });

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('add-board-button'));

    fireEvent.change(screen.getByLabelText('ticketing.boards.fields.boardName.label'), {
      target: { value: 'Escalations' },
    });
    fireEvent.change(screen.getByTestId('copy-ticket-statuses-select'), {
      target: { value: 'board-source' },
    });
    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
      expect(document.getElementById('inline-ticket-status-name-0')).toBeTruthy();
    });

    fireEvent.change(document.getElementById('inline-ticket-status-name-0') as HTMLInputElement, {
      target: { value: 'Escalations Open' },
    });

    fireEvent.click(screen.getByTestId('save-board-button'));

    await waitFor(() => {
      expect(createBoardMock).toHaveBeenCalledWith(
        expect.objectContaining({
          board_name: 'Escalations',
          copy_ticket_statuses_from_board_id: 'board-source',
          ticket_statuses: [
            expect.objectContaining({ name: 'Escalations Open', is_closed: false, is_default: true, order_number: 10 }),
            expect.objectContaining({ name: 'Support Closed', is_closed: true, is_default: false, order_number: 20 }),
          ],
        })
      );
    });
  });

  it('replaces copied draft statuses when the source board selection changes', async () => {
    getBoardTicketStatusesMock.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-source') {
        return [
          {
            status_id: 'status-source-open',
            name: 'Support Open',
            is_closed: false,
            is_default: true,
            order_number: 10,
          },
        ];
      }

      if (boardId === 'board-other') {
        return [
          {
            status_id: 'status-other-open',
            name: 'Field Ops New',
            is_closed: false,
            is_default: true,
            order_number: 10,
          },
        ];
      }

      return [];
    });

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('add-board-button'));
    fireEvent.change(screen.getByTestId('copy-ticket-statuses-select'), {
      target: { value: 'board-source' },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Support Open')).toBeInTheDocument();
    });

    fireEvent.change(document.getElementById('inline-ticket-status-name-0') as HTMLInputElement, {
      target: { value: 'Custom Support Open' },
    });

    fireEvent.change(screen.getByTestId('copy-ticket-statuses-select'), {
      target: { value: 'board-other' },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Field Ops New')).toBeInTheDocument();
    });

    expect(screen.queryByDisplayValue('Custom Support Open')).not.toBeInTheDocument();
  });

  it('passes inline-authored ticket statuses when creating a board from a new inline lifecycle', async () => {
    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('add-board-button'));

    fireEvent.change(screen.getByLabelText('ticketing.boards.fields.boardName.label'), {
      target: { value: 'Internal Ops' },
    });
    fireEvent.click(screen.getByTestId('ticket-status-seed-mode-create-inline'));
    fireEvent.change(document.getElementById('inline-ticket-status-name-0') as HTMLInputElement, {
      target: { value: 'Queued' },
    });
    fireEvent.click(screen.getByTestId('add-inline-ticket-status-button'));
    fireEvent.change(document.getElementById('inline-ticket-status-name-1') as HTMLInputElement, {
      target: { value: 'Done' },
    });
    fireEvent.click(screen.getByTestId('save-board-button'));

    await waitFor(() => {
      expect(createBoardMock).toHaveBeenCalledWith(
        expect.objectContaining({
          board_name: 'Internal Ops',
          ticket_statuses: [
            expect.objectContaining({ name: 'Queued', is_closed: false, is_default: true, order_number: 10 }),
            expect.objectContaining({ name: 'Done', is_closed: false, is_default: false, order_number: 20 }),
          ],
        })
      );
    });
  });

  it('T002: renders the live ticket timer toggle for create/edit and persists it in save payloads', async () => {
    getBoardTicketStatusesMock.mockResolvedValue([
      {
        status_id: 'status-open',
        name: 'Support Open',
        is_closed: false,
        is_default: true,
        order_number: 10,
      },
    ]);

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('add-board-button'));
    expandSection('display');
    expect(screen.getByText('ticketing.boards.fields.liveTimer.label')).toBeInTheDocument();
    expect(screen.getByTestId('enable_live_ticket_timer')).toBeChecked();
    fireEvent.change(screen.getByLabelText('ticketing.boards.fields.boardName.label'), {
      target: { value: 'Timer Policy Board' },
    });
    fireEvent.change(screen.getByTestId('copy-ticket-statuses-select'), {
      target: { value: 'board-source' },
    });
    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
    });

    fireEvent.click(screen.getByTestId('save-board-button'));

    await waitFor(() => {
      expect(createBoardMock).toHaveBeenCalledWith(
        expect.objectContaining({
          enable_live_ticket_timer: true,
        })
      );
    });

    fireEvent.click(screen.getAllByText('ticketing.boards.actions.edit')[0]);

    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
    });

    expandSection('display');
    expect(screen.getByTestId('enable_live_ticket_timer')).toBeChecked();
    fireEvent.click(screen.getByTestId('enable_live_ticket_timer'));
    expect(screen.getByTestId('enable_live_ticket_timer')).not.toBeChecked();

    fireEvent.click(screen.getByTestId('save-board-button'));

    await waitFor(() => {
      expect(updateBoardMock).toHaveBeenCalledWith(
        'board-source',
        expect.objectContaining({
          enable_live_ticket_timer: false,
        })
      );
    });
  });

  it('T020: blocks board save when inline ticket statuses do not contain exactly one open default', async () => {
    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('add-board-button'));

    fireEvent.change(screen.getByLabelText('ticketing.boards.fields.boardName.label'), {
      target: { value: 'Problem Board' },
    });
    fireEvent.click(screen.getByTestId('ticket-status-seed-mode-create-inline'));
    fireEvent.click(screen.getByTestId('inline-ticket-status-closed-0'));

    expect(screen.getByTestId('ticket-status-validation-error')).toHaveTextContent(
      'ticketing.boards.messages.error.invalidOpenDefault'
    );
    expect(screen.getByTestId('save-board-button')).toBeDisabled();

    fireEvent.click(screen.getByTestId('save-board-button'));
    expect(createBoardMock).not.toHaveBeenCalled();
  });

  it('T021: board edit loads only the selected board ticket statuses into the embedded manager', async () => {
    getAllBoardsMock.mockResolvedValue([
      {
        board_id: 'board-source',
        board_name: 'Support',
        display_order: 10,
        is_inactive: false,
      },
      {
        board_id: 'board-other',
        board_name: 'Field Ops',
        display_order: 20,
        is_inactive: false,
      },
    ]);
    getBoardTicketStatusesMock.mockResolvedValue([
      {
        status_id: 'status-open',
        name: 'Support Open',
        is_closed: false,
        is_default: true,
        order_number: 10,
      },
      {
        status_id: 'status-closed',
        name: 'Support Closed',
        is_closed: true,
        is_default: false,
        order_number: 20,
      },
    ]);

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText('ticketing.boards.actions.edit')[0]);

    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
    });

    expandSection('statuses');
    expect(screen.getByDisplayValue('Support Open')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Support Closed')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Field Ops Closed')).not.toBeInTheDocument();
  });

  it('opens the create editor with General and the required Statuses section expanded', async () => {
    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('add-board-button'));

    // General section body is rendered (its fields are reachable)...
    expect(screen.getByLabelText('ticketing.boards.fields.boardName.label')).toBeInTheDocument();
    // ...the required Statuses section is expanded up front (status setup is required)...
    expect(screen.getByTestId('copy-ticket-statuses-select')).toBeInTheDocument();
    expect(screen.getByText('ticketing.boards.editor.required')).toBeInTheDocument();
    // ...while other sections (e.g. Display) stay collapsed.
    expect(screen.queryByTestId('enable_live_ticket_timer')).not.toBeInTheDocument();
  });

  it('opens the editor for a board when its list row is clicked', async () => {
    getBoardTicketStatusesMock.mockResolvedValue([
      {
        status_id: 'status-open',
        name: 'Support Open',
        is_closed: false,
        is_default: true,
        order_number: 10,
      },
    ]);

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(document.getElementById('board-row-board-source') as HTMLElement);

    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
    });

    // Editor opened in edit mode with the clicked board's name loaded.
    expect(screen.getByDisplayValue('Support')).toBeInTheDocument();
  });

  it('keeps the editor open after saving changes to an existing board', async () => {
    getBoardTicketStatusesMock.mockResolvedValue([
      {
        status_id: 'status-open',
        name: 'Support Open',
        is_closed: false,
        is_default: true,
        order_number: 10,
      },
    ]);

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(document.getElementById('board-row-board-source') as HTMLElement);

    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
    });

    fireEvent.change(screen.getByLabelText('ticketing.boards.fields.boardName.label'), {
      target: { value: 'Support Renamed' },
    });
    fireEvent.click(screen.getByTestId('save-board-button'));

    await waitFor(() => {
      expect(updateBoardMock).toHaveBeenCalled();
    }, { timeout: 5_000 });

    // The editor stays open (no return to the list) and the header reflects the saved name.
    await waitFor(() => {
      expect(screen.getByTestId('save-board-button')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('add-board-button')).not.toBeInTheDocument();
    expect(screen.getByText('Support Renamed')).toBeInTheDocument();
  });

  it('shows an incomplete auto-close rule error inside the Automation section, not a top banner', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true });
    getBoardTicketStatusesMock.mockResolvedValue([
      {
        status_id: 'status-open',
        name: 'Support Open',
        is_closed: false,
        is_default: true,
        order_number: 10,
      },
    ]);

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    fireEvent.click(document.getElementById('board-row-board-source') as HTMLElement);

    await waitFor(() => {
      expect(getBoardTicketStatusesMock).toHaveBeenCalledWith('board-source');
    });

    // Add an auto-close rule with no trigger/target, then save.
    expandSection('automation');
    fireEvent.click(screen.getByTestId('add-auto-close-rule-button'));
    fireEvent.click(screen.getByTestId('save-board-button'));

    // The error renders inside the Automation section and the board is not saved.
    await waitFor(() => {
      expect(screen.getByTestId('board-editor-section-error-automation')).toHaveTextContent(
        'ticketing.boards.closeRules.messages.autoCloseStatusRequired'
      );
    });
    expect(updateBoardMock).not.toHaveBeenCalled();
  });

  it('paginates the boards list at 10 per page with prev/next controls', async () => {
    const manyBoards = Array.from({ length: 15 }, (_, i) => ({
      board_id: `board-${i + 1}`,
      board_name: `Board ${i + 1}`,
      display_order: (i + 1) * 10,
      is_inactive: false,
    }));
    getAllBoardsMock.mockResolvedValue(manyBoards);

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    // Page 1 shows the first 10 boards only.
    await waitFor(() => {
      expect(document.getElementById('board-row-board-1')).toBeInTheDocument();
    });
    expect(document.getElementById('board-row-board-10')).toBeInTheDocument();
    expect(document.getElementById('board-row-board-11')).not.toBeInTheDocument();

    // Advance to page 2 via the standard pagination next control.
    fireEvent.click(document.getElementById('boards-settings-table-pagination-next-btn') as HTMLElement);

    expect(document.getElementById('board-row-board-11')).toBeInTheDocument();
    expect(document.getElementById('board-row-board-1')).not.toBeInTheDocument();
  });

  it('exposes an items-per-page selector that resizes the page', async () => {
    const manyBoards = Array.from({ length: 15 }, (_, i) => ({
      board_id: `board-${i + 1}`,
      board_name: `Board ${i + 1}`,
      display_order: (i + 1) * 10,
      is_inactive: false,
    }));
    getAllBoardsMock.mockResolvedValue(manyBoards);

    render(<BoardsSettings />);

    await waitFor(() => {
      expect(getAllBoardsMock).toHaveBeenCalledWith(true);
    });
    // Also wait for the fetched boards to render before interacting: the add
    // handler reads the committed `boards` state (falling back to create_inline
    // seeding when boards.length === 0), so clicking while the resolved boards
    // are still uncommitted races away the copy-statuses select on slow runners.
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });

    // Default 10 per page: the 11th board is on page 2.
    await waitFor(() => {
      expect(document.getElementById('board-row-board-1')).toBeInTheDocument();
    });
    expect(document.getElementById('board-row-board-11')).not.toBeInTheDocument();

    // Raise the page size; all 15 boards now fit on one page.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '25' } });

    expect(document.getElementById('board-row-board-11')).toBeInTheDocument();
    expect(document.getElementById('board-row-board-15')).toBeInTheDocument();
  });
});
