/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketInfo from '../TicketInfo';

const getTicketStatusesMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: vi.fn(),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: ({ content }: { content: string }) => <div>{content}</div>,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id: string }) => (
    <button {...props} data-testid={id}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    value,
    options,
    onValueChange,
    disabled,
  }: {
    value?: string | null;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      disabled={disabled}
      value={value ?? ''}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components', () => ({
  PrioritySelect: () => <div data-testid="priority-select" />,
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-team-picker" />,
}));

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: () => <div data-testid="category-picker" />,
}));

vi.mock('../QuickAddCategory', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: () => <div data-testid="time-picker" />,
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../ResponseStateSelect', () => ({
  ResponseStateDisplay: () => <div data-testid="response-state-display" />,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="user-avatar" />,
}));

vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="team-avatar" />,
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/sla/components', () => ({
  SlaStatusBadge: () => <div data-testid="sla-status-badge" />,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  getTicketCategories: vi.fn().mockResolvedValue({ categories: [], boardConfig: { category_type: 'none', priority_type: 'custom', display_itil_impact: false, display_itil_urgency: false } }),
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({ categories: [], boardConfig: { category_type: 'none', priority_type: 'custom', display_itil_impact: false, display_itil_urgency: false } }),
}));

vi.mock('../../lib/ticketRichText', () => ({
  parseTicketRichTextContent: vi.fn().mockReturnValue([]),
  serializeTicketRichTextContent: vi.fn().mockReturnValue('[]'),
}));

vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: () => ({
    uploadFile: vi.fn(),
    requestDiscard: vi.fn(),
    resetDraftTracking: vi.fn(),
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
    keepDraftClipboardImages: vi.fn(),
  }),
}));

describe('TicketInfo board change status reselection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseTicket = {
    ticket_id: 'ticket-1',
    ticket_number: 'T-1001',
    title: 'Board-specific status test',
    status_id: 'status-a',
    board_id: 'board-a',
    assigned_to: null,
    category_id: null,
    subcategory_id: null,
    priority_id: 'priority-1',
    due_date: null,
    response_state: null,
    attributes: { description: '' },
    sla_policy_id: null,
    sla_paused_at: null,
    sla_response_at: null,
    sla_response_due_at: null,
    sla_resolution_at: null,
    sla_resolution_due_at: null,
    sla_started_at: null,
    entered_at: new Date('2026-03-14T10:00:00.000Z').toISOString(),
  } as any;

  it('T027: loads ticket status options only for the selected board', async () => {
    getTicketStatusesMock.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-a') {
        return [
          { status_id: 'status-a', name: 'Board A Default', is_closed: false },
          { status_id: 'status-a-closed', name: 'Board A Closed', is_closed: true },
        ];
      }

      return [{ status_id: 'status-b', name: 'Board B Default', is_closed: false }];
    });

    render(
      <TicketInfo
        id="ticket-info"
        ticket={baseTicket}
        conversations={[]}
        statusOptions={[]}
        agentOptions={[]}
        boardOptions={[
          { value: 'board-a', label: 'Board A' },
          { value: 'board-b', label: 'Board B' },
        ]}
        priorityOptions={[{ value: 'priority-1', label: 'Priority 1' }]}
        onSelectChange={vi.fn()}
        onSaveChanges={vi.fn().mockResolvedValue(true)}
        responseStateTrackingEnabled={false}
      />
    );

    await waitFor(() => {
      expect(getTicketStatusesMock).toHaveBeenCalledWith('board-a');
    });

    const [statusSelect] = screen.getAllByRole('combobox');
    const optionLabels = Array.from(statusSelect.querySelectorAll('option')).map((option) => option.textContent);

    expect(optionLabels).toContain('Board A Default');
    expect(optionLabels).toContain('Board A Closed');
    expect(optionLabels).not.toContain('Board B Default');
  });

  it('T028: disables the status picker when no board is selected', async () => {
    render(
      <TicketInfo
        id="ticket-info"
        ticket={{ ...baseTicket, board_id: null, status_id: null }}
        conversations={[]}
        statusOptions={[]}
        agentOptions={[]}
        boardOptions={[{ value: 'board-a', label: 'Board A' }]}
        priorityOptions={[{ value: 'priority-1', label: 'Priority 1' }]}
        onSelectChange={vi.fn()}
        onSaveChanges={vi.fn().mockResolvedValue(true)}
        responseStateTrackingEnabled={false}
      />
    );

    const [statusSelect] = screen.getAllByRole('combobox');

    await waitFor(() => {
      expect(statusSelect).toBeDisabled();
    });
    expect(getTicketStatusesMock).not.toHaveBeenCalled();
  });

  it('T030: reloads board-owned status options when the selected board changes', async () => {
    getTicketStatusesMock.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-a') {
        return [{ status_id: 'status-a', name: 'Board A Default', is_closed: false }];
      }

      return [
        { status_id: 'status-b', name: 'Board B Default', is_closed: false },
        { status_id: 'status-b-waiting', name: 'Board B Waiting', is_closed: false },
      ];
    });

    render(
      <TicketInfo
        id="ticket-info"
        ticket={baseTicket}
        conversations={[]}
        statusOptions={[]}
        agentOptions={[]}
        boardOptions={[
          { value: 'board-a', label: 'Board A' },
          { value: 'board-b', label: 'Board B' },
        ]}
        priorityOptions={[{ value: 'priority-1', label: 'Priority 1' }]}
        onSelectChange={vi.fn()}
        onSaveChanges={vi.fn().mockResolvedValue(true)}
        responseStateTrackingEnabled={false}
      />
    );

    const [statusSelect, boardSelect] = screen.getAllByRole('combobox');

    await waitFor(() => {
      expect(getTicketStatusesMock).toHaveBeenCalledWith('board-a');
    });

    fireEvent.change(boardSelect, { target: { value: 'board-b' } });

    await waitFor(() => {
      expect(getTicketStatusesMock).toHaveBeenCalledWith('board-b');
    });

    const optionLabels = Array.from(statusSelect.querySelectorAll('option')).map((option) => option.textContent);
    expect(optionLabels).toContain('Board B Default');
    expect(optionLabels).toContain('Board B Waiting');
    expect(optionLabels).not.toContain('Board A Default');
  });

  it('clears the current status and blocks save until a destination-board status is selected', async () => {
    getTicketStatusesMock.mockImplementation(async (boardId: string) => {
      if (boardId === 'board-a') {
        return [{ status_id: 'status-a', name: 'Board A Default', is_closed: false }];
      }

      return [{ status_id: 'status-b', name: 'Board B Default', is_closed: false }];
    });
    const onSaveChanges = vi.fn().mockResolvedValue(true);

    render(
      <TicketInfo
        id="ticket-info"
        ticket={baseTicket}
        conversations={[]}
        statusOptions={[]}
        agentOptions={[]}
        boardOptions={[
          { value: 'board-a', label: 'Board A' },
          { value: 'board-b', label: 'Board B' },
        ]}
        priorityOptions={[{ value: 'priority-1', label: 'Priority 1' }]}
        onSelectChange={vi.fn()}
        onSaveChanges={onSaveChanges}
        responseStateTrackingEnabled={false}
      />
    );

    const [statusSelect, boardSelect] = screen.getAllByRole('combobox');
    const saveButton = screen.getByTestId('ticket-info-save-changes-btn');

    await waitFor(() => {
      expect(getTicketStatusesMock).toHaveBeenCalledWith('board-a');
    });
    expect(statusSelect).toHaveValue('status-a');
    expect(saveButton).not.toBeDisabled();

    fireEvent.change(boardSelect, { target: { value: 'board-b' } });

    await waitFor(() => {
      expect(getTicketStatusesMock).toHaveBeenCalledWith('board-b');
      expect(statusSelect).toHaveValue('');
    });
    expect(screen.getByText('Select a status for the new board before saving.')).toBeInTheDocument();
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);
    expect(onSaveChanges).not.toHaveBeenCalled();

    fireEvent.change(statusSelect, { target: { value: 'status-b' } });

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSaveChanges).toHaveBeenCalledWith({
        board_id: 'board-b',
        status_id: 'status-b',
      });
    });
  });
});
