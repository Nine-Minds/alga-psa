/**
 * T206, T207 — F119 of `ee/plans/2026-11-21-itil-remediation` (`board-type-switch`).
 *
 * An existing board's kind is not an editable field: the editor shows what the board uses and
 * offers one action, which asks for a summary first and only switches on confirm. A legacy board
 * whose two kinds differ shows both, read-only, and is offered the same action.
 *
 * The harness is the one every BoardsSettings test file carries.
 */
/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BoardsSettings from './BoardsSettings';
import { toast } from 'react-hot-toast';

const getAllBoardsMock = vi.fn();
const createBoardMock = vi.fn();
const updateBoardMock = vi.fn();
const getBoardTicketStatusesMock = vi.fn();
const getAllPrioritiesMock = vi.fn();
const getAllUsersMock = vi.fn();
const getSlaPoliciesMock = vi.fn();
const getTeamsMock = vi.fn();
const checkCurrentUserPermissionsMock = vi.fn(async (checks: Array<{ resource: string; action: string }>) =>
  checks.map((c) => ({ ...c, granted: true }))
);
const useFeatureFlagMock = vi.fn(() => ({ enabled: false }));
const getBoardTypeSwitchSummaryMock = vi.fn();
const switchBoardTypeMock = vi.fn();

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

const listEmailSendersMock = vi.fn(async () => ({ senders: [], routes: [] }));
const listSelectableSendersMock = vi.fn(async () => ({ effectiveSenderAddress: 'provider@example.test', effectiveSenderDisplayName: 'Support' }));
const setEmailSenderRouteMock = vi.fn();
const clearEmailSenderRouteMock = vi.fn();
const renderBoardsSettings = () => render(<BoardsSettings listEmailSenders={listEmailSendersMock} listSelectableSenders={listSelectableSendersMock} setEmailSenderRoute={setEmailSenderRouteMock} clearEmailSenderRoute={clearEmailSenderRouteMock} />);

vi.mock('@alga-psa/tickets/actions/board-actions/boardActions', () => ({
  getAllBoards: (...args: unknown[]) => getAllBoardsMock(...args),
  getBoardListStats: () => Promise.resolve({}),
  createBoard: (...args: unknown[]) => createBoardMock(...args),
  updateBoard: (...args: unknown[]) => updateBoardMock(...args),
  deleteBoard: vi.fn(),
  clearBoardDefaultView: vi.fn(),
  getBoardTypeSwitchSummary: (...args: unknown[]) => getBoardTypeSwitchSummaryMock(...args),
  switchBoardType: (...args: unknown[]) => switchBoardTypeMock(...args),
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

vi.mock('../../actions/board-actions/boardNotificationActions', () => ({
  getBoardNotificationSettings: vi.fn().mockResolvedValue({ rules: [], default_watcher_user_ids: [] }),
  saveBoardNotificationSettings: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@alga-psa/auth/actions/permissionActions', () => ({
  checkCurrentUserPermissions: (...args: [Array<{ resource: string; action: string }>]) =>
    checkCurrentUserPermissionsMock(...args),
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

// The dialog is what this file is about, so it renders instead of being stubbed away.
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title, message, confirmLabel, onConfirm, onClose, id }: any) =>
    isOpen ? (
      <div data-testid={id}>
        <h2>{title}</h2>
        <div>{message}</div>
        <button type="button" onClick={() => onConfirm()}>{confirmLabel ?? 'confirm'}</button>
        <button type="button" onClick={() => onClose()}>common.cancel</button>
      </div>
    ) : null,
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

describe('BoardsSettings board type switch', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
    });
    vi.clearAllMocks();
    checkCurrentUserPermissionsMock.mockImplementation(async (checks) =>
      checks.map((check) => ({ ...check, granted: true }))
    );
    useFeatureFlagMock.mockReturnValue({ enabled: false });
    getAllBoardsMock.mockResolvedValue([
      {
        board_id: 'board-own',
        board_name: 'Support',
        display_order: 10,
        is_inactive: false,
        category_type: 'custom',
        priority_type: 'custom',
      },
      {
        board_id: 'board-mixed',
        board_name: 'Legacy Mixed',
        display_order: 20,
        is_inactive: false,
        category_type: 'custom',
        priority_type: 'itil',
      },
    ]);
    createBoardMock.mockResolvedValue({ board_id: 'board-new' });
    updateBoardMock.mockResolvedValue({ board_id: 'board-own' });
    getBoardTicketStatusesMock.mockResolvedValue([]);
    getAllPrioritiesMock.mockResolvedValue([]);
    getAllUsersMock.mockResolvedValue([]);
    getSlaPoliciesMock.mockResolvedValue([]);
    getTeamsMock.mockResolvedValue([]);
    listSelectableSendersMock.mockResolvedValue({
      effectiveSenderAddress: 'provider@example.test',
      effectiveSenderDisplayName: 'Support',
    });
    getBoardTypeSwitchSummaryMock.mockResolvedValue({
      boardId: 'board-own',
      boardName: 'Support',
      from: 'custom',
      to: 'itil',
      mixed: false,
      openTickets: 3,
      inboundDefaults: 1,
      templates: 0,
      schedules: 2,
      sla: { state: 'none' },
    });
    switchBoardTypeMock.mockResolvedValue({
      board_id: 'board-own',
      board_name: 'Support',
      category_type: 'itil',
      priority_type: 'itil',
      default_priority_id: 'priority-itil-3',
    });
  });

  const openEditor = async (boardId: string) => {
    renderBoardsSettings();
    await waitFor(() => expect(getAllBoardsMock).toHaveBeenCalledWith(true));
    await waitFor(() => expect(document.querySelector('[id^="board-row-"]')).toBeTruthy());
    fireEvent.click(document.getElementById(`board-row-${boardId}`) as HTMLElement);
    await waitFor(() => expect(getBoardTicketStatusesMock).toHaveBeenCalledWith(boardId));
    // The board type lives in the "Display & behaviour" section, which the accordion keeps closed.
    expandSection('display');
    await waitFor(() => expect(document.getElementById('board-type-current')).toBeTruthy());
  };

  it('T206: the confirmation shows the summary and switches only on confirm', async () => {
    await openEditor('board-own');

    fireEvent.click(screen.getByTestId('board-change-type-button'));

    await waitFor(() => expect(getBoardTypeSwitchSummaryMock).toHaveBeenCalledWith('board-own', 'itil'));
    await waitFor(() => expect(document.getElementById('board-change-type-summary')).toBeTruthy());
    // The counts and the SLA line are what the admin is shown before deciding.
    expect(screen.getByText('ticketing.boards.dialog.changeBoardTypeTickets')).toBeInTheDocument();
    expect(document.getElementById('board-change-type-sla')?.textContent).toBe(
      'ticketing.boards.dialog.changeBoardTypeSlaNone'
    );
    expect(switchBoardTypeMock).not.toHaveBeenCalled();

    // Cancel changes nothing.
    fireEvent.click(screen.getByText('common.cancel'));
    await waitFor(() => expect(document.getElementById('board-change-type-summary')).toBeFalsy());
    expect(switchBoardTypeMock).not.toHaveBeenCalled();

    // Confirm does.
    fireEvent.click(screen.getByTestId('board-change-type-button'));
    await waitFor(() => expect(document.getElementById('board-change-type-summary')).toBeTruthy());
    fireEvent.click(screen.getByText('ticketing.boards.dialog.changeBoardTypeConfirm'));
    await waitFor(() => expect(switchBoardTypeMock).toHaveBeenCalledWith('board-own', 'itil'));
  });

  it('T207: a legacy mixed board shows both kinds read-only and is offered the switch', async () => {
    getBoardTypeSwitchSummaryMock.mockResolvedValue({
      boardId: 'board-mixed',
      boardName: 'Legacy Mixed',
      from: 'itil',
      to: 'itil',
      mixed: true,
      openTickets: 0,
      inboundDefaults: 0,
      templates: 0,
      schedules: 0,
      sla: { state: 'none' },
    });

    await openEditor('board-mixed');

    // Both kinds, as text: the editor has no control that could set one of them on its own.
    expect(document.getElementById('board-type-current')?.textContent).toBe(
      'ticketing.boards.fields.boardType.mixed'
    );
    expect(document.getElementById('is_itil_compliant')).toBeFalsy();

    fireEvent.click(screen.getByTestId('board-change-type-button'));
    await waitFor(() => expect(getBoardTypeSwitchSummaryMock).toHaveBeenCalledWith('board-mixed', 'itil'));
  });
});
