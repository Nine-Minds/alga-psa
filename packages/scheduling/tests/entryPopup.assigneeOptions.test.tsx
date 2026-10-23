/**
 * @vitest-environment jsdom
 */
/**
 * Regression for the EntryPopup assignee picker: the option list must come from
 * the host's `user_schedule:read`-gated user list (ScheduleCalendar feeds
 * getShareableUsers), not getAllUsers/user:read. A viewer without user:read must
 * still see active colleagues, a delegate (and a group-calendar editor without
 * user_schedule:update) must be limited to their assignable set (plus stored
 * assignees), and a stored assignee's real name must render even in a read-only
 * entry — together with a "View Entry" title.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EntryPopup from '../src/components/schedule/EntryPopup';

const {
  getTeamsMeetingCapability,
  getAppointmentRequestById,
  getScheduleEntryTeamsMeeting,
  scheduleTeamsMeeting,
  getWorkItemById,
  approveAppointmentRequest,
  declineAppointmentRequest,
  getUserAvatarUrlsBatchAction,
} = vi.hoisted(() => ({
  getTeamsMeetingCapability: vi.fn(),
  getAppointmentRequestById: vi.fn(),
  getScheduleEntryTeamsMeeting: vi.fn(),
  scheduleTeamsMeeting: vi.fn(),
  getWorkItemById: vi.fn(),
  approveAppointmentRequest: vi.fn(),
  declineAppointmentRequest: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  approveAppointmentRequest,
  declineAppointmentRequest,
  getTeamsMeetingCapability,
  getAppointmentRequestById,
  getScheduleEntryTeamsMeeting,
  scheduleTeamsMeeting,
  getWorkItemById,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, any>) => {
      if (typeof options === 'string') return options;
      const template = options?.defaultValue ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) =>
        String(options?.[name] ?? ''),
      );
    },
  }),
  useFormatters: () => ({
    formatDate: (value: Date | string) => new Date(value).toISOString().slice(11, 16),
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  getErrorMessage: (value: unknown) => String(value),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

// Render the Dialog title so a read-only entry's "View Entry" heading is
// observable; the real Dialog portals it.
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, title }: any) => (
    <div>
      {title ? <h2 data-testid="dialog-title">{title}</h2> : null}
      {children}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, type = 'button', ...props }: any) => (
    <button type={type} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: (props: any) => <input type="date" {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange, label }: any) => (
    <label htmlFor={id}>
      {label}
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
  DeleteEntityDialog: () => null,
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/WorkItemDrawer', () => ({
  WorkItemDrawer: () => null,
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/AddWorkItemDialog', () => ({
  AddWorkItemDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options = [], value, onValueChange }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

// Mirrors UserPicker's visible contract: it renders the selected user's real
// name when that user is present in `users`, and lists the option set. This is
// what proves EntryPopup fed it the stored assignee and the right candidates.
vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  default: ({ value, users, placeholder = 'Not assigned', disabled }: any) => {
    const current = (users ?? []).find((user: any) => user.user_id === value);
    const name = (user: any) => `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return (
      <div data-testid="user-picker" data-disabled={String(Boolean(disabled))}>
        <span data-testid="user-picker-value">{current ? name(current) : placeholder}</span>
        <ul data-testid="user-picker-options">
          {(users ?? []).map((user: any) => (
            <li key={user.user_id} data-testid={`user-option-${user.user_id}`}>
              {name(user)}
            </li>
          ))}
        </ul>
      </div>
    );
  },
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/SelectedWorkItem', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ id, value, onChange, disabled }: any) => (
    <input
      id={id}
      data-testid={id}
      type="text"
      disabled={disabled}
      value={value ? new Date(value).toISOString() : ''}
      onChange={(event) => onChange(new Date(event.target.value))}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children }: any) => <label>{children}</label>,
}));

vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({
  preCheckDeletion: vi.fn(),
}));

const START = new Date('2026-09-23T10:00:00Z');
const END = new Date('2026-09-23T11:00:00Z');

const user = (user_id: string, first_name: string, last_name: string) => ({
  user_id,
  first_name,
  last_name,
  user_type: 'internal',
  is_inactive: false,
});

const VIEWER = user('viewer', 'Vera', 'Viewer');
const ALICE = user('alice', 'Alice', 'Adams');
const TIN = user('tin', 'Tin', 'Woodman');
const CAROL = user('carol', 'Carol', 'Chen');

const entry = (overrides: Record<string, any>) => ({
  entry_id: 'entry-1',
  title: 'On-call',
  scheduled_start: START,
  scheduled_end: END,
  notes: '',
  created_at: START,
  updated_at: START,
  work_item_id: null,
  work_item_type: 'ad_hoc',
  status: 'scheduled',
  assigned_user_ids: ['tin'],
  is_private: false,
  ...overrides,
});

const baseProps = {
  onClose: () => {},
  onSave: () => {},
  canAssignMultipleAgents: false,
  currentUserId: VIEWER.user_id,
  canModifySchedule: false,
  focusedTechnicianId: VIEWER.user_id,
  canAssignOthers: false,
};

const pickerValue = () => screen.getByTestId('user-picker-value').textContent;

describe('EntryPopup assignee options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTeamsMeetingCapability.mockResolvedValue({ available: false });
    getAppointmentRequestById.mockResolvedValue({ success: false });
    getScheduleEntryTeamsMeeting.mockResolvedValue({ success: true, data: null });
    getWorkItemById.mockResolvedValue(null);
    getUserAvatarUrlsBatchAction.mockResolvedValue({});
  });

  it('limits a group-calendar editor without user_schedule:update to the viewer, edit shares, and stored assignees', async () => {
    render(
      <EntryPopup
        {...baseProps}
        event={entry({ calendar_id: 'group-cal-1', can_edit: true })}
        users={[VIEWER, ALICE, TIN, CAROL]}
        // Group calendar edit access does not widen the assignee set: the server
        // still rejects assignees the viewer has no edit share on (PRD l.122).
        assignableUserIds={[VIEWER.user_id, ALICE.user_id]}
      />
    );

    expect(await screen.findByTestId('user-picker')).toBeInTheDocument();
    expect(screen.getByTestId(`user-option-${VIEWER.user_id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`user-option-${ALICE.user_id}`)).toBeInTheDocument();
    // The stored assignee is kept even though they are outside the edit-share set.
    expect(screen.getByTestId(`user-option-${TIN.user_id}`)).toBeInTheDocument();
    // An arbitrary colleague outside the viewer/edit-share/stored sets is not offered.
    expect(screen.queryByTestId(`user-option-${CAROL.user_id}`)).toBeNull();
    expect(
      screen.getByTestId('user-picker-options').querySelectorAll('li')
    ).toHaveLength(3);
    expect(pickerValue()).toBe('Tin Woodman');
  });

  it('limits a delegate to the viewer, the sharer, and the stored assignee', async () => {
    render(
      <EntryPopup
        {...baseProps}
        event={entry({ can_edit: true })}
        users={[VIEWER, ALICE, TIN, CAROL]}
        assignableUserIds={[VIEWER.user_id, ALICE.user_id]}
      />
    );

    expect(await screen.findByTestId('user-picker')).toBeInTheDocument();
    expect(screen.getByTestId(`user-option-${VIEWER.user_id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`user-option-${ALICE.user_id}`)).toBeInTheDocument();
    // The stored assignee is kept even though they are outside the delegate set.
    expect(screen.getByTestId(`user-option-${TIN.user_id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`user-option-${CAROL.user_id}`)).toBeNull();
    expect(
      screen.getByTestId('user-picker-options').querySelectorAll('li')
    ).toHaveLength(3);
    expect(pickerValue()).toBe('Tin Woodman');
  });

  it('shows the stored assignee and a View Entry title on a read-only entry', async () => {
    render(
      <EntryPopup
        {...baseProps}
        // viewOnly is false: this is the permission-driven read-only path that
        // used to fall through to "Edit Entry".
        viewOnly={false}
        event={entry({ calendar_id: 'group-cal-1', can_edit: false })}
        users={[VIEWER, ALICE, TIN, CAROL]}
      />
    );

    expect(await screen.findByTestId('user-picker')).toBeInTheDocument();
    expect(pickerValue()).toBe('Tin Woodman');
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('View Entry');
  });
});
