/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryPopup from '../src/components/schedule/EntryPopup';

/**
 * Creating a Teams meeting rewrites the entry's notes server-side (and, for a
 * recurring occurrence, materializes it into a new concrete entry), but the
 * calendar's fetched events used to stay stale: closing the popup and
 * reopening it without a reload showed pre-link notes — which a Save then
 * persisted, deleting the join URL — and left the dead virtual occurrence on
 * the calendar offering Create again. EntryPopup now reports the linked entry
 * upward through onTeamsMeetingCreated and the parent refetches its events.
 * The harness below holds an events collection the same way ScheduleCalendar
 * does (fetchEvents into state, the opened popup bound to the event object
 * captured at click time) so the close-then-reopen paths run against the
 * refreshed collection.
 */

const {
  getTeamsMeetingCapability,
  getAppointmentRequestById,
  approveAppointmentRequest,
  declineAppointmentRequest,
  getScheduleEntryTeamsMeeting,
  scheduleTeamsMeeting,
  getWorkItemById,
  getUserAvatarUrlsBatchAction,
} = vi.hoisted(() => ({
  getTeamsMeetingCapability: vi.fn(),
  getAppointmentRequestById: vi.fn(),
  approveAppointmentRequest: vi.fn(),
  declineAppointmentRequest: vi.fn(),
  getScheduleEntryTeamsMeeting: vi.fn(),
  scheduleTeamsMeeting: vi.fn(),
  getWorkItemById: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
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
    formatDate: (value: Date | string) =>
      new Date(value).toISOString().slice(11, 16),
  }),
}));

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

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  default: ({ id }: any) => <select id={id} />,
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

// The "server": the entries a fetch would return and the meetings linked to
// them. scheduleTeamsMeeting mutates it the way the real action does — notes
// rewritten in place for a standalone entry, virtual occurrence replaced by a
// materialized concrete entry for a recurring one.
let serverEvents: any[] = [];
let serverMeetings: Record<string, { meeting_id: string; join_url: string }> = {};
let savedEntries: any[] = [];

// Minimal stand-in for ScheduleCalendar's contract around EntryPopup: events
// live in state fed by a fetch, the popup binds the event object captured when
// it was opened, and onTeamsMeetingCreated triggers a refetch (never onSave).
const CalendarHarness = () => {
  const [events, setEvents] = React.useState<any[]>(() => [...serverEvents]);
  const [selected, setSelected] = React.useState<any | null>(null);
  const fetchEvents = () => setEvents([...serverEvents]);
  return (
    <div>
      {events.map((ev) => (
        <button
          key={ev.entry_id}
          data-testid={`calendar-event-${ev.entry_id}`}
          onClick={() => setSelected(ev)}
        >
          {ev.title}
        </button>
      ))}
      {selected ? (
        <EntryPopup
          event={selected}
          onClose={() => setSelected(null)}
          onSave={(entryData: any) => {
            savedEntries.push(entryData);
            setSelected(null);
          }}
          onTeamsMeetingCreated={() => fetchEvents()}
          canAssignMultipleAgents={false}
          users={[] as any}
          currentUserId="tech-1"
          canModifySchedule={true}
          focusedTechnicianId={null}
          canAssignOthers={true}
        />
      ) : null}
    </div>
  );
};

const openEntry = (entryId: string) =>
  fireEvent.click(screen.getByTestId(`calendar-event-${entryId}`));

const closePopup = () =>
  fireEvent.click(document.getElementById('cancel-entry-btn') as HTMLButtonElement);

const clickSave = () =>
  fireEvent.click(document.getElementById('save-entry-btn') as HTMLButtonElement);

const notesField = () => document.getElementById('notes') as HTMLTextAreaElement;

describe('EntryPopup Teams meeting creation refreshes the calendar', () => {
  beforeEach(() => {
    serverEvents = [];
    serverMeetings = {};
    savedEntries = [];
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

  it('standalone entry: reopening without a reload shows the persisted join link and Save preserves it', async () => {
    serverEvents = [baseEntry({ entry_id: 'entry-standalone' })];
    scheduleTeamsMeeting.mockImplementation(async ({ scheduleEntryId }: any) => {
      const entry = serverEvents.find((ev) => ev.entry_id === scheduleEntryId);
      entry.notes = `${entry.notes}\n\nJoin Teams Meeting: ${JOIN_URL}`;
      serverMeetings[scheduleEntryId] = { meeting_id: 'meeting-1', join_url: JOIN_URL };
      return {
        success: true,
        data: {
          meeting_id: 'meeting-1',
          join_url: JOIN_URL,
          schedule_entry_id: scheduleEntryId,
          schedule_entry_notes: entry.notes,
        },
      };
    });

    render(<CalendarHarness />);
    openEntry('entry-standalone');

    fireEvent.click(await screen.findByRole('button', { name: 'Create Teams meeting' }));
    await screen.findByRole('button', { name: 'Join Teams Meeting' });

    // The refresh is not routed through onSave — no update was issued.
    expect(savedEntries).toHaveLength(0);

    closePopup();
    openEntry('entry-standalone');

    // The reopened popup binds the refetched entry: persisted notes, Join not Create.
    await screen.findByRole('button', { name: 'Join Teams Meeting' });
    expect(screen.queryByRole('button', { name: 'Create Teams meeting' })).toBeNull();
    expect(notesField().value).toContain(JOIN_URL);

    clickSave();
    expect(savedEntries).toHaveLength(1);
    expect(savedEntries[0].notes).toContain(JOIN_URL);
  });

  it('recurring occurrence: the refreshed calendar replaces the virtual occurrence with the materialized entry', async () => {
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

    render(<CalendarHarness />);
    openEntry(VIRTUAL_ID);

    fireEvent.click(await screen.findByRole('button', { name: 'Create Teams meeting' }));

    // The stale virtual occurrence is gone from the calendar; the
    // materialized concrete entry replaced it.
    await waitFor(() =>
      expect(screen.queryByTestId(`calendar-event-${VIRTUAL_ID}`)).toBeNull(),
    );
    screen.getByTestId('calendar-event-entry-materialized');

    closePopup();
    openEntry('entry-materialized');

    // The reopened entry is a standalone one with the meeting attached — it
    // offers Join, never Create-again.
    await screen.findByRole('button', { name: 'Join Teams Meeting' });
    expect(screen.queryByRole('button', { name: 'Create Teams meeting' })).toBeNull();
    expect(notesField().value).toContain(JOIN_URL);

    clickSave();
    expect(savedEntries).toHaveLength(1);
    expect(savedEntries[0].entry_id).toBe('entry-materialized');
    expect(savedEntries[0].recurrence_pattern).toBeNull();
    expect(savedEntries[0].notes).toContain(JOIN_URL);
  });
});
