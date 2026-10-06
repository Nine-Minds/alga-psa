/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BoardsSettings from '../BoardsSettings';
import { toast } from 'react-hot-toast';

const getAllBoardsMock = vi.fn();
const createBoardMock = vi.fn();
const updateBoardMock = vi.fn();
const getBoardTicketStatusesMock = vi.fn();
const getAllPrioritiesMock = vi.fn();
const getAllUsersMock = vi.fn();
const getSlaPoliciesMock = vi.fn();
const getTeamsMock = vi.fn();
const getBoardNotificationSettingsMock = vi.fn();
const saveBoardNotificationSettingsMock = vi.fn();
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
}));

vi.mock('@alga-psa/tickets/actions/board-actions/boardTicketStatusActions', () => ({
  getBoardTicketStatuses: (...args: unknown[]) => getBoardTicketStatusesMock(...args),
}));

vi.mock('../../../actions/close-rules/closeRuleActions', () => ({
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

vi.mock('../../../actions/board-actions/boardNotificationActions', () => ({
  getBoardNotificationSettings: (...args: unknown[]) => getBoardNotificationSettingsMock(...args),
  saveBoardNotificationSettings: (...args: unknown[]) => saveBoardNotificationSettingsMock(...args),
}));

vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({
  __esModule: true,
  default: ({ id, onValuesChange, onTeamValuesChange }: any) => (
    <div id={id}>
      <button type="button" id={`${id}-pick-user`} onClick={() => onValuesChange(['user-1'])} />
      <button type="button" id={`${id}-pick-team`} onClick={() => onTeamValuesChange(['team-1'])} />
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/MultiUserPicker', () => ({
  __esModule: true,
  default: ({ id, onValuesChange }: any) => (
    <div id={id}>
      <button type="button" id={`${id}-pick`} onClick={() => onValuesChange(['user-2'])} />
    </div>
  ),
}));

// The Button/Switch mocks surface their id as data-testid.
const findById = (id: string) => document.getElementById(id) ?? document.querySelector(`[data-testid="${id}"]`);

describe('BoardsSettings notifications section', () => {
  const click = (id: string) => {
    const el = findById(id);
    expect(el, `element #${id}`).toBeTruthy();
    fireEvent.click(el as HTMLElement);
  };

  const openEditor = async () => {
    renderBoardsSettings();
    await waitFor(() => {
      expect(document.querySelector('[id^="board-row-"]')).toBeTruthy();
    });
    fireEvent.click(document.getElementById('board-row-board-source')!);
    // The row opens the editor via the actions menu or row click; fall back to the edit item.
    await waitFor(() => {
      expect(findById('board-editor-back')).toBeTruthy();
    });
    await waitFor(() => {
      expect(getBoardNotificationSettingsMock).toHaveBeenCalledWith('board-source');
    });
    expandSection('notifications');
  };

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
    });
    vi.clearAllMocks();
    useFeatureFlagMock.mockReturnValue({ enabled: false });
    getAllBoardsMock.mockResolvedValue([
      { board_id: 'board-source', board_name: 'Support', display_order: 10, is_inactive: false },
    ]);
    updateBoardMock.mockResolvedValue({ board_id: 'board-source' });
    getBoardTicketStatusesMock.mockResolvedValue([
      { status_id: 'status-new', name: 'New', is_closed: false, is_default: true, order_number: 10 },
      { status_id: 'status-done', name: 'Done', is_closed: true, is_default: false, order_number: 20 },
    ]);
    getAllPrioritiesMock.mockResolvedValue([]);
    getAllUsersMock.mockResolvedValue([]);
    getSlaPoliciesMock.mockResolvedValue([]);
    getTeamsMock.mockResolvedValue([]);
    getBoardNotificationSettingsMock.mockResolvedValue({
      rules: [],
      default_watcher_user_ids: [],
    });
    saveBoardNotificationSettingsMock.mockImplementation(async (_id: string, input: any) => input);
  });

  it('adds and removes rules with unique, index-based element ids', async () => {
    await openEditor();

    click('add-board-notification-rule-button');
    click('add-board-notification-rule-button');

    expect(document.getElementById('board-notification-rule-0')).toBeTruthy();
    expect(document.getElementById('board-notification-rule-1')).toBeTruthy();
    expect(document.getElementById('board-notification-rule-1-status-status-new')).toBeTruthy();
    expect(document.getElementById('board-notification-rule-1-status-status-done')).toBeTruthy();

    const section = document.getElementById('board-notification-rule-0')!.parentElement!;
    const ids = Array.from(section.querySelectorAll('[id]')).map((el) => el.id);
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
    for (const el of Array.from(section.querySelectorAll('input,button'))) {
      expect(el.id || el.getAttribute('data-testid'), 'interactive element has an id').toBeTruthy();
    }
    const allIds = Array.from(section.querySelectorAll('[id],[data-testid]')).map(
      (el) => el.id || (el.getAttribute('data-testid') as string)
    );
    expect(new Set(allIds).size).toBe(allIds.length);

    click('board-notification-rule-0-remove');
    expect(document.getElementById('board-notification-rule-1')).toBeNull();
    expect(document.getElementById('board-notification-rule-0')).toBeTruthy();
  });

  it('blocks save and shows a message when a rule has no trigger or no recipient', async () => {
    await openEditor();
    click('add-board-notification-rule-button');
    click('board-notification-rule-0-recipients-pick-user');

    // Uncheck the only trigger.
    click('board-notification-rule-0-create');
    click('save-board-section-notifications');
    await waitFor(() => {
      expect(screen.getByTestId('board-editor-section-error-notifications')).toHaveTextContent(
        'ticketing.boards.editor.sections.notificationsTriggerRequired'
      );
    });

    // Re-enable the trigger and add a second rule that has a trigger but no recipient.
    click('board-notification-rule-0-create');
    click('add-board-notification-rule-button');
    click('save-board-section-notifications');
    await waitFor(() => {
      expect(screen.getByTestId('board-editor-section-error-notifications')).toHaveTextContent(
        'ticketing.boards.editor.sections.notificationsRecipientRequired'
      );
    });

    expect(updateBoardMock).not.toHaveBeenCalled();
    expect(saveBoardNotificationSettingsMock).not.toHaveBeenCalled();
  });

  it('saves rules and default watchers through saveBoardNotificationSettings, reusing stable rule ids', async () => {
    getBoardNotificationSettingsMock.mockResolvedValue({
      rules: [
        {
          rule_id: 'rule-existing',
          notify_on_create: true,
          status_ids: [],
          user_ids: ['user-9'],
          team_ids: [],
          is_enabled: true,
        },
      ],
      default_watcher_user_ids: [],
    });
    await openEditor();
    await waitFor(() => {
      expect(document.getElementById('board-notification-rule-0')).toBeTruthy();
    });

    click('add-board-notification-rule-button');
    click('board-notification-rule-1-create');
    click('board-notification-rule-1-status-status-new');
    click('board-notification-rule-1-recipients-pick-user');
    click('board-notification-rule-1-recipients-pick-team');
    click('board-notification-rule-1-enabled');
    click('board-default-watchers-picker-pick');

    click('save-board-section-notifications');

    await waitFor(() => {
      expect(saveBoardNotificationSettingsMock).toHaveBeenCalledTimes(1);
    });
    const [boardId, payload] = saveBoardNotificationSettingsMock.mock.calls[0];
    expect(boardId).toBe('board-source');
    expect(payload).toEqual({
      rules: [
        {
          rule_id: 'rule-existing',
          notify_on_create: true,
          status_ids: [],
          user_ids: ['user-9'],
          team_ids: [],
          is_enabled: true,
        },
        {
          rule_id: undefined,
          notify_on_create: false,
          status_ids: ['status-new'],
          user_ids: ['user-1'],
          team_ids: ['team-1'],
          is_enabled: false,
        },
      ],
      default_watcher_user_ids: ['user-2'],
    });
    expect(updateBoardMock).toHaveBeenCalled();
  });
});
