/**
 * @vitest-environment jsdom
 */
// Exercise the existing feature behavior with the release flag enabled.
vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));

import React from 'react';
import toast from 'react-hot-toast';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleEntryDeepLink } from '@alga-psa/core';
import ScheduleCalendar from '../src/components/schedule/ScheduleCalendar';

/**
 * ScheduleCalendar's `?entryId=` deep link: the real calendar + real EntryPopup, with the grid stubbed.
 * The link fetches the entry through getScheduleEntryById, opens it in the entry dialog, and moves the
 * calendar to its date (or the named occurrence's); a missing or unreadable entry toasts and leaves the
 * page usable.
 */

const {
  getScheduleEntries,
  getScheduleEntryById,
  addScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  getAppointmentRequestById,
  getTeamsMeetingCapability,
  getScheduleEntryTeamsMeeting,
  scheduleTeamsMeeting,
  getWorkItemById,
  approveAppointmentRequest,
  declineAppointmentRequest,
  getCurrentUser,
  getCurrentUserPermissions,
  getUserAvatarUrlsBatchAction,
  getShareableUsers,
} = vi.hoisted(() => ({
  getScheduleEntries: vi.fn(),
  getScheduleEntryById: vi.fn(),
  addScheduleEntry: vi.fn(),
  updateScheduleEntry: vi.fn(),
  deleteScheduleEntry: vi.fn(),
  getAppointmentRequestById: vi.fn(),
  getTeamsMeetingCapability: vi.fn(),
  getScheduleEntryTeamsMeeting: vi.fn(),
  scheduleTeamsMeeting: vi.fn(),
  getWorkItemById: vi.fn(),
  approveAppointmentRequest: vi.fn(),
  declineAppointmentRequest: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
  getShareableUsers: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  // Shared calendars: the viewer sees every calendar (user_schedule:update).
  getCalendarsVisibleToMe: vi.fn(async () => ({
    success: true,
    data: {
      viewerUserId: 'tech-1',
      canViewAll: true,
      me: {
        key: 'tech-1', calendar_type: 'personal', calendar_id: null, owner_user_id: 'tech-1',
        name: 'Tess Tech', color: '#2563eb', access_level: 'edit',
      },
      people: [],
      groups: [],
    },
  })),
  getMyCalendarShares: vi.fn(async () => ({ success: true, data: [] })),
  setMyCalendarShares: vi.fn(async () => ({ success: true, data: [] })),
  getShareableTeams: vi.fn(async () => ({ success: true, data: [] })),
  getShareableUsers,
  createGroupCalendar: vi.fn(),
  updateGroupCalendar: vi.fn(),
  getGroupCalendarShares: vi.fn(async () => ({ success: true, data: [] })),
  setGroupCalendarShares: vi.fn(),
  archiveGroupCalendar: vi.fn(),
  restoreGroupCalendar: vi.fn(),
  getScheduleEntries,
  getScheduleEntryById,
  addScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  getAppointmentRequestById,
  getTeamsMeetingCapability,
  getScheduleEntryTeamsMeeting,
  scheduleTeamsMeeting,
  getWorkItemById,
  approveAppointmentRequest,
  declineAppointmentRequest,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser,
  getCurrentUserPermissions,
  getUserAvatarUrlsBatchAction,
}));

vi.mock('@alga-psa/user-composition/hooks', () => {
  // Stable references: ScheduleCalendar feeds hook results into memo/effect
  // dependency chains (fetchEvents depends on them transitively), so a mock
  // returning fresh objects per render would refetch in an infinite loop.
  const usersResult = {
    users: [
      { user_id: 'tech-1', first_name: 'Tess', last_name: 'Tech', is_inactive: false },
    ],
    loading: false,
    error: null,
  };
  const preferenceResult = { value: 'week', setValue: vi.fn(), isLoading: false };
  return {
    useUsers: () => usersResult,
    useUserPreference: () => preferenceResult,
  };
});

// The calendar grid itself is not under test: stand it in with one button per
// event, wired to the real onSelectEvent, so clicking an event opens the real
// EntryPopup through ScheduleCalendar's own handleSelectEvent.
const calendarSurface = vi.hoisted(() => ({ props: null as any }));
vi.mock('next/dynamic', () => ({
  default: () => (props: any) => {
    calendarSurface.props = props;
    return (
    <div>
      {props.events.map((ev: any) => (
        <button
          key={ev.entry_id}
          type="button"
          data-testid={`calendar-event-${ev.entry_id}`}
          onClick={(event) => props.onSelectEvent(ev, event)}
        >
          {ev.title}
        </button>
      ))}
    </div>
  ); },
}));

vi.mock('react-big-calendar', () => ({
  momentLocalizer: () => ({}),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable references: fetchEvents lists `t` in its dependency array — a
  // fresh `t` per render would re-run the fetch effect in an infinite loop.
  const translation = {
    t: (key: string, options?: string | Record<string, any>) => {
      if (typeof options === 'string') return options;
      const template = options?.defaultValue ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) =>
        String(options?.[name] ?? ''),
      );
    },
  };
  const formatters = {
    formatDate: (value: Date | string) =>
      new Date(value).toISOString().slice(11, 16),
  };
  return {
    useTranslation: () => translation,
    useFormatters: () => formatters,
  };
});

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  getErrorMessage: (value: unknown) => String(value),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
  DeleteEntityDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  // The real Button defaults type to 'button'; without that, every mocked
  // button inside the form (Cancel included) would submit it.
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
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: () => null,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
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

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  // Expose the option set so a test can prove ScheduleCalendar fed the popup
  // the gated getShareableUsers list rather than useUsers/displayedTechnicians.
  default: ({ value, users, placeholder = 'Not assigned' }: any) => {
    const current = (users ?? []).find((user: any) => user.user_id === value);
    const name = (user: any) => `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return (
      <div data-testid="user-picker">
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

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/skeletons/CalendarSkeleton', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/PrintButton', () => ({
  usePrintAction: () => ({ triggerPrint: vi.fn(), isPreparing: false }),
}));

vi.mock('@alga-psa/ui/components/PrintOptionsDialog', () => ({
  PrintOptionsDialog: () => null,
  usePrintColumnSelection: () => ({
    selectedColumnKeys: [],
    selectedColumns: [],
    setSelectedColumnKeys: vi.fn(),
    resetSelectedColumnKeys: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/components/ShareActionsMenu', () => ({
  ShareActionsMenu: () => null,
}));

vi.mock('@alga-psa/ui/components/PrintableTable', () => ({
  PrintableTable: () => null,
}));

vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({
  preCheckDeletion: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/WorkItemDrawer', () => ({
  WorkItemDrawer: () => null,
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/AddWorkItemDialog', () => ({
  AddWorkItemDialog: () => null,
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/SelectedWorkItem', () => ({
  default: () => null,
}));

vi.mock('../src/components/schedule/CalendarStyleProvider', () => ({
  CalendarStyleProvider: () => null,
}));

vi.mock('../src/components/schedule/TechnicianSidebar', () => ({
  default: () => null,
}));

vi.mock('../src/components/schedule/WeeklyScheduleEvent', () => ({
  default: () => null,
}));


const MASTER = '3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64';

const entry = (overrides: Record<string, any> = {}) => ({
  entry_id: MASTER,
  title: 'Call back about VPN',
  scheduled_start: '2031-03-10T15:00:00.000Z',
  scheduled_end: '2031-03-10T16:00:00.000Z',
  notes: '',
  created_at: '2031-03-01T00:00:00.000Z',
  updated_at: '2031-03-01T00:00:00.000Z',
  work_item_id: null,
  status: 'scheduled',
  work_item_type: 'ad_hoc',
  assigned_user_ids: ['tech-1'],
  is_private: false,
  is_recurring: false,
  access: 'full',
  ...overrides,
});

const titleField = () => document.getElementById('title') as HTMLInputElement | null;
const rangeStarts = () =>
  getScheduleEntries.mock.calls.map((call) => (call[0] as Date).getTime());

describe('ScheduleCalendar ?entryId= deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ user_id: 'tech-1' });
    getCurrentUserPermissions.mockResolvedValue(['user_schedule:update', 'user_schedule:read:all']);
    getScheduleEntries.mockResolvedValue({ success: true, entries: [] });
    getTeamsMeetingCapability.mockResolvedValue({ available: true });
    getAppointmentRequestById.mockResolvedValue({ success: false });
    getWorkItemById.mockResolvedValue(null);
    getUserAvatarUrlsBatchAction.mockResolvedValue({});
    getShareableUsers.mockResolvedValue({ success: true, data: [] });
    getScheduleEntryTeamsMeeting.mockResolvedValue({ success: true, data: null });
  });

  const renderWith = async (deepLink: ScheduleEntryDeepLink | null) => {
    const onDeepLinkHandled = vi.fn();
    render(<ScheduleCalendar deepLink={deepLink} onDeepLinkHandled={onDeepLinkHandled} />);
    return onDeepLinkHandled;
  };

  it('opens the entry in the dialog, moves the calendar to its date and reports the link handled', async () => {
    getScheduleEntryById.mockResolvedValue(entry());
    const handled = await renderWith({ entryId: MASTER });

    await waitFor(() => expect(titleField()?.value).toBe('Call back about VPN'));
    expect(getScheduleEntryById).toHaveBeenCalledWith(MASTER);
    expect(handled).toHaveBeenCalledTimes(1);
    // A refetch for the entry's week (2031-03-09 .. 15) follows the date change.
    await waitFor(() => {
      const march9 = new Date(2031, 2, 9).getTime();
      expect(rangeStarts()).toContain(march9);
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('opens the named occurrence of a recurring master at the occurrence date', async () => {
    getScheduleEntryById.mockResolvedValue(entry({ is_recurring: true }));
    const occurrence = new Date('2031-04-14T15:00:00.000Z');
    await renderWith({ entryId: MASTER, occurrence });

    await waitFor(() => expect(titleField()?.value).toBe('Call back about VPN'));
    await waitFor(() => {
      const apr13 = new Date(2031, 3, 13).getTime();
      expect(rangeStarts()).toContain(apr13);
    });
    // The dialog edits the occurrence, not the series: its start is the occurrence and it is not the master.
    expect((document.getElementById('scheduled_start') as HTMLInputElement).value).toBe('2031-04-14T15:00:00.000Z');
  });

  it.each([
    ['is missing or not visible', null],
    ['is refused with a permission error', { success: false, permissionError: 'Permission denied', code: 'PERMISSION_DENIED' }],
  ])('toasts and leaves the page usable when the entry %s', async (_label, result) => {
    getScheduleEntryById.mockResolvedValue(result);
    const handled = await renderWith({ entryId: MASTER });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(titleField()).toBeNull();
    expect(handled).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getScheduleEntries).toHaveBeenCalled());
  });

  it('toasts instead of crashing when the read throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getScheduleEntryById.mockRejectedValue(new Error('boom'));
    const handled = await renderWith({ entryId: MASTER });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(handled).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('does nothing without a deep link', async () => {
    await renderWith(null);
    await act(async () => {});
    expect(getScheduleEntryById).not.toHaveBeenCalled();
  });
});
