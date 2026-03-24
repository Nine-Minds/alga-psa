/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { QuickAddTicket } from '../QuickAddTicket';

const getTicketFormDataMock = vi.fn();
const getTicketStatusesMock = vi.fn();

vi.mock('next/server', () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    next: vi.fn(),
    json: vi.fn(),
  },
}));

vi.mock('next-auth', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock('next-auth/lib/env', () => ({
  setEnvDefaults: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('../../actions/ticketActions', () => ({
  addTicket: vi.fn(),
  updateTicket: vi.fn(),
}));

vi.mock('../../actions/ticketResourceActions', () => ({
  addTicketResource: vi.fn(),
}));

vi.mock('../../actions/ticketFormActions', () => ({
  getTicketFormData: (...args: unknown[]) => getTicketFormDataMock(...args),
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactsByClient: vi.fn().mockResolvedValue([]),
  getClientLocations: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({
    categories: [],
    boardConfig: {
      category_type: 'custom',
      priority_type: 'custom',
      display_itil_impact: false,
      display_itil_urgency: false,
    },
  }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  getUserAvatarUrlsBatchAction: vi.fn(),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({
    renderQuickAddClient: () => null,
    renderQuickAddContact: () => null,
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: () => <div data-testid="contact-picker" />,
}));

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: () => <div data-testid="category-picker" />,
}));

vi.mock('../QuickAddCategory', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({
    boards,
    onSelect,
    selectedBoardId,
  }: {
    boards: Array<{ board_id?: string | null; board_name?: string | null }>;
    onSelect: (boardId: string) => void;
    selectedBoardId: string | null;
  }) => (
    <div>
      <div data-testid="board-picker-selected">{selectedBoardId || ''}</div>
      {boards.map((board) => (
        <button key={board.board_id} type="button" onClick={() => onSelect(board.board_id || '')}>
          Select {board.board_name}
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
      data-testid={id || 'custom-select'}
      value={value || ''}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
      <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
      </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-team-picker" />,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: () => <div data-testid="time-picker" />,
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  __esModule: true,
  default: () => <div data-testid="spinner" />,
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => <div data-testid="tag-picker" />,
}));

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }),
}));

vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: () => ({}),
}));

vi.mock('../useQuickAddRichTextUploadSession', () => ({
  useQuickAddRichTextUploadSession: () => ({
    uploadFile: vi.fn(),
    requestDiscard: vi.fn(),
    resetDraftTracking: vi.fn(),
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
    keepDraftClipboardImages: vi.fn(),
  }),
}));

vi.mock('../../lib/ticketRichText', () => ({
  parseTicketRichTextContent: vi.fn().mockReturnValue([]),
  serializeTicketRichTextContent: vi.fn().mockReturnValue(''),
}));

vi.mock('../../lib/ticketRichTextImages', () => ({
  removeTicketRichTextImageUrls: vi.fn().mockImplementation((value) => value),
  replaceTicketRichTextImageUrls: vi.fn().mockImplementation((value) => value),
}));

describe('QuickAddTicket board-scoped statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketFormDataMock.mockResolvedValue({
      users: [],
      boards: [
        { board_id: 'board-a', board_name: 'Board A', priority_type: 'custom' },
        { board_id: 'board-b', board_name: 'Board B', priority_type: 'custom' },
      ],
      statuses: [],
      priorities: [{ priority_id: 'priority-1', priority_name: 'Priority 1', item_type: 'ticket' }],
      clients: [],
    });
    getTicketStatusesMock.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-a') {
        return [
          { status_id: 'status-a-default', name: 'Board A Default', is_default: true, is_closed: false },
          { status_id: 'status-a-closed', name: 'Board A Closed', is_default: false, is_closed: true },
        ];
      }

      return [
        { status_id: 'status-b-default', name: 'Board B Default', is_default: true, is_closed: false },
      ];
    });
  });

  it('T029: keeps the status picker empty until a board is chosen, then selects that board default only', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={vi.fn()}
        onTicketAdded={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getTicketFormDataMock).toHaveBeenCalled();
    });

    const statusSelect = screen.getByTestId('ticket-quick-add');
    expect(screen.getByTestId('board-picker-selected')).toHaveTextContent('');
    expect(statusSelect).toBeDisabled();
    expect(statusSelect).toHaveValue('');
    expect(getTicketStatusesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Select Board A'));

    await waitFor(() => {
      expect(getTicketStatusesMock).toHaveBeenCalledWith('board-a');
    });

    expect(screen.getByTestId('board-picker-selected')).toHaveTextContent('board-a');
    expect(statusSelect).not.toBeDisabled();
    expect(statusSelect).toHaveValue('status-a-default');

    const optionLabels = Array.from(statusSelect.querySelectorAll('option')).map((option) => option.textContent);
    expect(optionLabels).toContain('Board A Default');
    expect(optionLabels).toContain('Board A Closed');
    expect(optionLabels).not.toContain('Board B Default');
  });
});
