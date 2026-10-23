/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketInfo from '../TicketInfo';

const getTicketStatusesMock = vi.fn();
const crossFeatureRef = vi.hoisted(() => ({ value: null as any }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: vi.fn(),
  useOptionalActivityCrossFeature: () => crossFeatureRef.value,
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

vi.mock('@alga-psa/ui/components/tickets/PrioritySelect', () => ({
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

vi.mock('../../CategoryPicker', () => ({
  CategoryPicker: () => <button type="button">Category</button>,
}));

vi.mock('../../QuickAddCategory', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <button type="button">Due date</button>,
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: () => <button type="button">Due date and time</button>,
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../../ResponseStateSelect', () => ({
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

vi.mock('../../../actions/ticketCategoryActions', () => ({
  getTicketCategories: vi.fn().mockResolvedValue({ categories: [], boardConfig: { category_type: 'none', priority_type: 'custom', display_itil_impact: false, display_itil_urgency: false } }),
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({ categories: [], boardConfig: { category_type: 'none', priority_type: 'custom', display_itil_impact: false, display_itil_urgency: false } }),
}));

vi.mock('../../../lib/ticketRichText', () => ({
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

describe('TicketInfo "My group" host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crossFeatureRef.value = null;
    getTicketStatusesMock.mockResolvedValue([{ status_id: 'status-a', name: 'Open', is_closed: false }]);
  });

  it('renders normally and does not throw without a cross-feature provider (AlgaDesk)', () => {
    renderTicketInfo();
    expect(screen.queryByTestId('group-control')).toBeNull();
    expect(screen.getByText('Board-specific status test')).toBeTruthy();
  });

  it('renders normally when the provider has no renderActivityGroupControl', () => {
    crossFeatureRef.value = {};
    renderTicketInfo();
    expect(screen.queryByTestId('group-control')).toBeNull();
  });

  it('passes ticket type, ticket id and a saved-state assignmentKey, outside the field grid', () => {
    const renderActivityGroupControl = vi.fn((p: any) => (
      <span data-testid="group-control">{p.activityType}:{p.activityId}</span>
    ));
    crossFeatureRef.value = { renderActivityGroupControl };
    renderTicketInfo({
      ticket: { ...baseTicket, assigned_to: 'user-1' },
      additionalAgents: [{ user_id: 'u-b', name: 'B' }, { user_id: 'u-a', name: 'A' }],
    });
    const control = screen.getByTestId('group-control');
    expect(control.textContent).toBe('ticket:ticket-1');
    expect(renderActivityGroupControl).toHaveBeenCalledWith({
      id: 'ticket-info-activity-group',
      activityType: 'ticket',
      activityId: 'ticket-1',
      assignmentKey: 'user-1|u-a,u-b',
    });
    // not inside the shared two-column field grid
    expect(control.closest('.grid-cols-2')).toBeNull();
  });

  it('assignmentKey follows the saved ticket prop, not unsaved form edits', () => {
    const renderActivityGroupControl = vi.fn((_p: any) => <span data-testid="group-control" />);
    crossFeatureRef.value = { renderActivityGroupControl };
    renderTicketInfo({ ticket: { ...baseTicket, assigned_to: 'user-1' } });
    const first = renderActivityGroupControl.mock.calls.at(-1)![0] as any;
    // Editing an unsaved field never changes the key.
    fireEvent.change(screen.getByTestId('priority-select'), { target: { value: 'priority-2' } });
    const last = renderActivityGroupControl.mock.calls.at(-1)![0] as any;
    expect(last.assignmentKey).toBe(first.assignmentKey);
  });
});
