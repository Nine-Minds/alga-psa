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

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: ({ content }: { content: string }) => <div>{content}</div>,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
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
      data-testid="custom-select"
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
  PrioritySelect: ({
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
      data-testid="priority-select"
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

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <button type="button">Assignee</button>,
}));

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: () => <button type="button">Category</button>,
}));

vi.mock('../QuickAddCategory', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <button type="button">Due date</button>,
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: () => <button type="button">Due time</button>,
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../ResponseStateSelect', () => ({
  ResponseStateDisplay: () => <button type="button">Response state</button>,
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
  Input: ({ containerClassName: _containerClassName, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/sla', () => ({
  SlaStatusBadge: () => <div data-testid="sla-status-badge" />,
}));

vi.mock('@alga-psa/ui/presence/FieldConflictBanner', () => ({
  FieldConflictBanner: () => <div data-testid="field-conflict-banner" />,
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    deleteDocument: vi.fn(),
  }),
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

function renderTicketInfo(overrides: Partial<React.ComponentProps<typeof TicketInfo>> = {}) {
  return render(
    <TicketInfo
      id="ticket-info"
      ticket={baseTicket}
      conversations={[]}
      statusOptions={[
        { value: 'status-a', label: 'Open' },
        { value: 'status-b', label: 'Closed' },
      ]}
      agentOptions={[]}
      boardOptions={[
        { value: 'board-a', label: 'Board A' },
        { value: 'board-b', label: 'Board B' },
      ]}
      priorityOptions={[
        { value: 'priority-1', label: 'Priority 1' },
        { value: 'priority-2', label: 'Priority 2' },
      ]}
      onSelectChange={vi.fn()}
      onSaveChanges={vi.fn().mockResolvedValue(true)}
      responseStateTrackingEnabled={false}
      {...overrides}
    />
  );
}

describe('TicketInfo live editing awareness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketStatusesMock.mockResolvedValue([
      { status_id: 'status-a', name: 'Open', is_closed: false },
      { status_id: 'status-b', name: 'Closed', is_closed: true },
    ]);
  });

  it('T040: focusing status sets editingField and blurring clears it', async () => {
    const onLiveEditingFieldChange = vi.fn();

    renderTicketInfo({ onLiveEditingFieldChange });

    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.focus(statusSelect);
    fireEvent.blur(statusSelect);

    expect(onLiveEditingFieldChange).toHaveBeenCalledWith('status_id');
    expect(onLiveEditingFieldChange).toHaveBeenCalledWith(null);
  });

  it('T041: remote priority awareness dims the field and renders the editing caption', () => {
    renderTicketInfo({ liveEditingUsers: { priority_id: ['Alex'] } });

    expect(screen.getByTestId('ticket-info-priority-editing-indicator')).toHaveTextContent('Alex is editing');
    expect(screen.getByTestId('priority-select').closest('[data-live-field="priority_id"]')).toHaveAttribute('data-live-editing', 'true');
  });

  it('T042: editing indicator clears when the remote awareness disappears', () => {
    const view = renderTicketInfo({ liveEditingUsers: { priority_id: ['Alex'] } });
    expect(screen.getByTestId('ticket-info-priority-editing-indicator')).toHaveTextContent('Alex is editing');

    view.rerender(
      <TicketInfo
        id="ticket-info"
        ticket={baseTicket}
        conversations={[]}
        statusOptions={[
          { value: 'status-a', label: 'Open' },
          { value: 'status-b', label: 'Closed' },
        ]}
        agentOptions={[]}
        boardOptions={[
          { value: 'board-a', label: 'Board A' },
          { value: 'board-b', label: 'Board B' },
        ]}
        priorityOptions={[
          { value: 'priority-1', label: 'Priority 1' },
          { value: 'priority-2', label: 'Priority 2' },
        ]}
        onSelectChange={vi.fn()}
        onSaveChanges={vi.fn().mockResolvedValue(true)}
        responseStateTrackingEnabled={false}
        liveEditingUsers={{}}
      />
    );

    expect(screen.queryByTestId('ticket-info-priority-editing-indicator')).not.toBeInTheDocument();
  });

  it('T043: remote status awareness does not hard-lock the field while the local user focuses it', async () => {
    const onLiveEditingFieldChange = vi.fn();

    renderTicketInfo({
      liveEditingUsers: { status_id: ['Alex'] },
      onLiveEditingFieldChange,
    });

    const statusSelect = screen.getAllByRole('combobox')[0];
    expect(screen.getByTestId('ticket-info-status-editing-indicator')).toHaveTextContent('Alex is editing');
    await waitFor(() => {
      expect(statusSelect).not.toBeDisabled();
    });

    fireEvent.focus(statusSelect);

    expect(onLiveEditingFieldChange).toHaveBeenCalledWith('status_id');
  });

  it('T058: focusing the title input reports title editing and renders the remote pill variant', () => {
    const onLiveEditingFieldChange = vi.fn();

    const view = renderTicketInfo({
      liveEditingUsers: { title: ['Alex'] },
      onLiveEditingFieldChange,
    });

    expect(screen.getByTestId('ticket-info-title-editing-pill')).toHaveTextContent('Alex is editing');

    fireEvent.click(screen.getByTitle('Edit title'));
    const titleInput = screen.getByDisplayValue('Board-specific status test');
    fireEvent.focus(titleInput);
    fireEvent.blur(titleInput);

    expect(onLiveEditingFieldChange).toHaveBeenCalledWith('title');
    expect(onLiveEditingFieldChange).toHaveBeenCalledWith(null);

    view.rerender(
      <TicketInfo
        id="ticket-info"
        ticket={baseTicket}
        conversations={[]}
        statusOptions={[
          { value: 'status-a', label: 'Open' },
          { value: 'status-b', label: 'Closed' },
        ]}
        agentOptions={[]}
        boardOptions={[
          { value: 'board-a', label: 'Board A' },
          { value: 'board-b', label: 'Board B' },
        ]}
        priorityOptions={[
          { value: 'priority-1', label: 'Priority 1' },
          { value: 'priority-2', label: 'Priority 2' },
        ]}
        onSelectChange={vi.fn()}
        onSaveChanges={vi.fn().mockResolvedValue(true)}
        responseStateTrackingEnabled={false}
        liveEditingUsers={{}}
      />
    );

    expect(screen.queryByTestId('ticket-info-title-editing-pill')).not.toBeInTheDocument();
  });
});
