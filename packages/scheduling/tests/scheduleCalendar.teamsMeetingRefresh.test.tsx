/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ScheduleCalendar from '../src/components/schedule/ScheduleCalendar';

/**
 * Behavioral coverage of ScheduleCalendar's side of the Teams-meeting refresh
 * wiring: the real ScheduleCalendar renders the real EntryPopup, the calendar
 * grid is stubbed down to clickable event buttons, and every entry the fake
 * server hands out is a fresh object — the calendar's fetched events can only
 * reflect post-link state if ScheduleCalendar actually refetches after
 * onTeamsMeetingCreated fires. The refresh must happen through the fetch
 * action, never through the save path: onSave issues another update from the
 * stale selected event, which clobbers rewritten notes and is unsafe for
 * virtual occurrences that no longer exist server-side.
 */

const {
  getScheduleEntries,
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
} = vi.hoisted(() => ({
  getScheduleEntries: vi.fn(),
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
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getScheduleEntries,
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
vi.mock('next/dynamic', () => ({
  default: () => (props: any) => (
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
  ),
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
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
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
  default: ({ id }: any) => <select id={id} />,
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

const JOIN_URL = 'https://teams.example.test/join/abc';

const baseEntry = (overrides: Record<string, any>) => ({
  title: 'Kickoff',
  scheduled_start: '2026-09-04T14:00:00.000Z',
  scheduled_end: '2026-09-04T15:00:00.000Z',
  notes: 'Agenda',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  work_item_id: null,
  status: 'scheduled',
  work_item_type: 'ad_hoc',
  assigned_user_ids: ['tech-1'],
  is_private: false,
  is_recurring: false,
  ...overrides,
});

// The fake server. Every fetch hands out fresh copies of fresh objects and
// scheduleTeamsMeeting REPLACES entries rather than mutating them in place, so
// the calendar's events state cannot see post-link data through shared object
// references — only an actual refetch surfaces it.
let serverEvents: any[] = [];
let serverMeetings: Record<string, { meeting_id: string; join_url: string }> = {};

const openEntry = (entryId: string) =>
  fireEvent.click(screen.getByTestId(`calendar-event-${entryId}`));

const closePopup = () =>
  fireEvent.click(document.getElementById('cancel-entry-btn') as HTMLButtonElement);

const clickSave = () =>
  fireEvent.click(document.getElementById('save-entry-btn') as HTMLButtonElement);

const notesField = () => document.getElementById('notes') as HTMLTextAreaElement;

describe('ScheduleCalendar refreshes its events after a Teams meeting is created', () => {
  beforeEach(() => {
    serverEvents = [];
    serverMeetings = {};
    getCurrentUser.mockResolvedValue({ user_id: 'tech-1' });
    getCurrentUserPermissions.mockResolvedValue(['user_schedule:update', 'user_schedule:read:all']);
    getScheduleEntries.mockImplementation(async () => ({
      success: true,
      entries: serverEvents.map((ev) => ({ ...ev })),
    }));
    updateScheduleEntry.mockImplementation(async (entryId: string, data: any) => {
      const index = serverEvents.findIndex((ev) => ev.entry_id === entryId);
      if (index >= 0) {
        serverEvents[index] = { ...serverEvents[index], ...data, entry_id: entryId };
      }
      return { success: true, entry: { ...data, entry_id: entryId } };
    });
    getTeamsMeetingCapability.mockResolvedValue({ available: true });
    getAppointmentRequestById.mockResolvedValue({ success: false });
    getWorkItemById.mockResolvedValue(null);
    getUserAvatarUrlsBatchAction.mockResolvedValue({});
    getScheduleEntryTeamsMeeting.mockImplementation(async (entryId: string) => ({
      success: true,
      data: serverMeetings[entryId] ?? null,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('standalone entry: creating a meeting refetches events (not via save) so reopen binds the persisted entry', async () => {
    serverEvents = [baseEntry({ entry_id: 'entry-standalone' })];
    scheduleTeamsMeeting.mockImplementation(async ({ scheduleEntryId }: any) => {
      const entry = serverEvents.find((ev) => ev.entry_id === scheduleEntryId);
      const rewrittenNotes = `${entry.notes}\n\nJoin Teams Meeting: ${JOIN_URL}`;
      serverEvents = serverEvents.map((ev) =>
        ev.entry_id === scheduleEntryId ? { ...ev, notes: rewrittenNotes } : ev,
      );
      serverMeetings[scheduleEntryId] = { meeting_id: 'meeting-1', join_url: JOIN_URL };
      return {
        success: true,
        data: {
          meeting_id: 'meeting-1',
          join_url: JOIN_URL,
          schedule_entry_id: scheduleEntryId,
          schedule_entry_notes: rewrittenNotes,
        },
      };
    });

    render(<ScheduleCalendar />);
    await screen.findByTestId('calendar-event-entry-standalone');
    const fetchesBeforeCreate = getScheduleEntries.mock.calls.length;

    openEntry('entry-standalone');
    fireEvent.click(await screen.findByRole('button', { name: 'Create Teams meeting' }));
    await screen.findByRole('button', { name: 'Join Teams Meeting' });

    // ScheduleCalendar answered onTeamsMeetingCreated with a refetch...
    await waitFor(() =>
      expect(getScheduleEntries.mock.calls.length).toBeGreaterThan(fetchesBeforeCreate),
    );
    // ...and never through the save path: no update was issued by the refresh.
    expect(updateScheduleEntry).not.toHaveBeenCalled();
    expect(addScheduleEntry).not.toHaveBeenCalled();

    closePopup();
    openEntry('entry-standalone');

    // The reopened popup binds the refetched entry — persisted notes, Join not
    // Create. The fake server only exposed these via the refetch.
    await screen.findByRole('button', { name: 'Join Teams Meeting' });
    expect(screen.queryByRole('button', { name: 'Create Teams meeting' })).toBeNull();
    expect(notesField().value).toContain(JOIN_URL);

    // An explicit Save after reopen persists the join link instead of
    // clobbering it with pre-link notes.
    clickSave();
    await waitFor(() => expect(updateScheduleEntry).toHaveBeenCalledTimes(1));
    const [savedEntryId, savedData] = updateScheduleEntry.mock.calls[0];
    expect(savedEntryId).toBe('entry-standalone');
    expect(savedData.notes).toContain(JOIN_URL);
  });

  it('recurring occurrence: the refetch replaces the dead virtual event with the materialized entry and save targets it', async () => {
    const VIRTUAL_ID = 'master-recurring_1757000000000';
    serverEvents = [
      baseEntry({
        entry_id: VIRTUAL_ID,
        title: 'Standup',
        notes: 'Series notes',
        is_recurring: true,
        original_entry_id: 'master-recurring',
      }),
    ];
    scheduleTeamsMeeting.mockImplementation(async () => {
      // The server materializes the occurrence: the virtual event is no longer
      // generated and a concrete entry carries the meeting.
      const materializedNotes = `Series notes\n\nJoin Teams Meeting: ${JOIN_URL}`;
      serverEvents = [
        baseEntry({
          entry_id: 'entry-materialized',
          title: 'Standup',
          notes: materializedNotes,
          is_recurring: false,
        }),
      ];
      serverMeetings['entry-materialized'] = { meeting_id: 'meeting-2', join_url: JOIN_URL };
      return {
        success: true,
        data: {
          meeting_id: 'meeting-2',
          join_url: JOIN_URL,
          schedule_entry_id: 'entry-materialized',
          schedule_entry_notes: materializedNotes,
        },
      };
    });

    render(<ScheduleCalendar />);
    await screen.findByTestId(`calendar-event-${VIRTUAL_ID}`);

    openEntry(VIRTUAL_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Teams meeting' }));

    // The refetched calendar dropped the stale virtual occurrence and shows
    // the materialized concrete entry instead.
    await waitFor(() =>
      expect(screen.queryByTestId(`calendar-event-${VIRTUAL_ID}`)).toBeNull(),
    );
    screen.getByTestId('calendar-event-entry-materialized');
    // The refresh never went through the save path — nothing tried to update
    // the virtual occurrence that no longer exists server-side.
    expect(updateScheduleEntry).not.toHaveBeenCalled();

    closePopup();
    openEntry('entry-materialized');

    await screen.findByRole('button', { name: 'Join Teams Meeting' });
    expect(screen.queryByRole('button', { name: 'Create Teams meeting' })).toBeNull();
    expect(notesField().value).toContain(JOIN_URL);

    // Saving the reopened entry updates the materialized entry, never the
    // virtual id, and keeps the join link.
    clickSave();
    await waitFor(() => expect(updateScheduleEntry).toHaveBeenCalledTimes(1));
    const [savedEntryId, savedData] = updateScheduleEntry.mock.calls[0];
    expect(savedEntryId).toBe('entry-materialized');
    expect(savedData.notes).toContain(JOIN_URL);
    expect(savedData.recurrence_pattern).toBeNull();
  });
});
