// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import AgentScheduleView from '../src/components/schedule/AgentScheduleView';
import toast from 'react-hot-toast';

// vi.hoisted: mock factories run while this module's imports evaluate —
// plain consts would still be in their temporal dead zone at that point.
const { calendarSpy, getScheduleEntries, addScheduleEntry, getCurrentUser, getCurrentUserPermissions, useUsers } =
  vi.hoisted(() => ({
    calendarSpy: vi.fn(),
    getScheduleEntries: vi.fn(),
    addScheduleEntry: vi.fn(),
    getCurrentUser: vi.fn(),
    getCurrentUserPermissions: vi.fn(),
    useUsers: vi.fn(() => ({ users: [] })),
  }));

vi.mock('next/dynamic', () => ({
  default: () => (props: any) => {
    calendarSpy(props);
    return <div data-testid="calendar" />;
  }
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getScheduleEntries,
  addScheduleEntry,
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

// Stable `t` reference: AgentScheduleView lists `t` in its effect dependency
// arrays, so a fresh function per render would re-run the fetch effect forever.
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const translation = {
    t: (key: string, options?: string | Record<string, any>) => {
      if (typeof options === 'string') return options;
      const template = options?.defaultValue ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) =>
        String(options?.[name] ?? ''),
      );
    },
  };
  return {
    useTranslation: () => translation,
  };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser,
  getCurrentUserPermissions,
}));
// AgentScheduleView imports these from user-composition, not users.
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser,
  getCurrentUserPermissions,
}));

// AgentScheduleView imports useUsers from user-composition. (Do NOT mock
// '@alga-psa/users/hooks' — that subpath isn't in the users exports map, and
// registering a mock for an unresolvable specifier aborts collection.)
vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUsers,
  // ScheduleCalendar (rendered inside AgentScheduleView) reads a view
  // preference from the same barrel.
  useUserPreference: () => ({ value: undefined, setValue: vi.fn() }),
}));

const entryPopupSpy = vi.fn();
vi.mock('../src/components/schedule/EntryPopup', () => ({
  default: (props: any) => {
    entryPopupSpy(props);
    return <div data-testid="entry-popup" />;
  },
}));

vi.mock('../src/components/schedule/CalendarStyleProvider', () => ({
  CalendarStyleProvider: () => <div data-testid="calendar-style-provider" />,
}));

vi.mock('../src/components/schedule/AgentScheduleDrawerStyles', () => ({
  AgentScheduleDrawerStyles: () => <div data-testid="agent-drawer-styles" />,
}));

beforeEach(() => {
  calendarSpy.mockClear();
  entryPopupSpy.mockClear();
  getScheduleEntries.mockClear();
  addScheduleEntry.mockClear();
  getScheduleEntries.mockResolvedValue({ success: true, entries: [] });
  addScheduleEntry.mockResolvedValue({ success: true, entry: { entry_id: 'entry-new' } });
  getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  getCurrentUserPermissions.mockResolvedValue(['user_schedule:read:all', 'user_schedule:update']);
});

describe('AgentScheduleView', () => {
  it('renders without error for a valid agent', () => {
    const { getByTestId } = render(<AgentScheduleView agentId="agent-1" />);
    expect(getByTestId('calendar')).toBeTruthy();
  });

  it('calls getScheduleEntries with the agent ID and date range', async () => {
    render(<AgentScheduleView agentId="agent-1" />);

    await waitFor(() => expect(getScheduleEntries).toHaveBeenCalled());

    const [start, end, technicianIds] = getScheduleEntries.mock.calls[0];
    expect(technicianIds).toEqual(['agent-1']);
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
    expect((end as Date).getTime()).toBeGreaterThan((start as Date).getTime());
  });

  it('shows a loading state while fetching events', async () => {
    let resolvePromise: (value: any) => void = () => {};
    const pending = new Promise((resolve) => {
      resolvePromise = resolve as (value: any) => void;
    });
    getScheduleEntries.mockReturnValueOnce(pending);

    const { getByText } = render(<AgentScheduleView agentId="agent-1" />);
    expect(getByText(/Loading/i)).toBeTruthy();

    resolvePromise({ success: true, entries: [] });
  });

  it('defaults to week view', () => {
    render(<AgentScheduleView agentId="agent-1" />);
    const props = calendarSpy.mock.calls[0][0];
    expect(props.defaultView).toBe('week');
    expect(props.view).toBe('week');
  });

  it('allows switching between day, week, and month views', () => {
    render(<AgentScheduleView agentId="agent-1" />);
    const initialProps = calendarSpy.mock.calls[0][0];

    act(() => {
      initialProps.onView('day');
    });

    const dayProps = calendarSpy.mock.calls.at(-1)[0];
    expect(dayProps.view).toBe('day');

    act(() => {
      dayProps.onView('month');
    });

    const monthProps = calendarSpy.mock.calls.at(-1)[0];
    expect(monthProps.view).toBe('month');
  });

  it('applies work item colors to events', () => {
    render(<AgentScheduleView agentId="agent-1" />);
    const props = calendarSpy.mock.calls[0][0];
    const result = props.eventPropGetter({ work_item_type: 'ticket' });

    expect(result.style.backgroundColor).toBe('rgb(var(--color-primary-200))');
  });

  it('opens EntryPopup when an event is clicked', async () => {
    const { getByTestId } = render(<AgentScheduleView agentId="agent-1" />);
    const props = calendarSpy.mock.calls[0][0];

    act(() => {
      props.onSelectEvent({
        entry_id: 'entry-1',
        scheduled_start: new Date(),
        scheduled_end: new Date(),
        work_item_type: 'ticket',
        assigned_user_ids: [],
      });
    });

    // The popup waits for the async current-user resolution.
    await waitFor(() => expect(getByTestId('entry-popup')).toBeTruthy());

    // Not isInDrawer: EntryPopup must wrap itself in a Dialog so it overlays
    // the full-height calendar instead of rendering offscreen below it.
    expect(entryPopupSpy.mock.calls.at(-1)[0].isInDrawer).toBe(false);
  });

  it('sets scrollToTime to 8 AM', () => {
    render(<AgentScheduleView agentId="agent-1" />);
    const props = calendarSpy.mock.calls[0][0];
    const scrollToTime = props.scrollToTime as Date;

    expect(scrollToTime.getHours()).toBe(8);
    expect(scrollToTime.getMinutes()).toBe(0);
  });

  it('restricts users with user_schedule:read to their own schedule', async () => {
    getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
    getCurrentUserPermissions.mockResolvedValue(['user_schedule:read']);

    const { getByText } = render(<AgentScheduleView agentId="user-2" />);

    await waitFor(() => expect(getByText(/permission/i)).toBeTruthy());
    expect(getScheduleEntries).not.toHaveBeenCalled();
  });

  it('allows users with user_schedule:read:all to view any agent', async () => {
    getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
    getCurrentUserPermissions.mockResolvedValue(['user_schedule:read:all']);

    render(<AgentScheduleView agentId="user-2" />);

    await waitFor(() => expect(getScheduleEntries).toHaveBeenCalled());
    const [, , technicianIds] = getScheduleEntries.mock.calls[0];
    expect(technicianIds).toEqual(['user-2']);
  });

  it('renders CalendarStyleProvider and AgentScheduleDrawerStyles', () => {
    const { getByTestId } = render(<AgentScheduleView agentId="agent-1" />);
    expect(getByTestId('calendar-style-provider')).toBeTruthy();
    expect(getByTestId('agent-drawer-styles')).toBeTruthy();
  });

  it('keeps the calendar non-selectable without a work item context', () => {
    render(<AgentScheduleView agentId="agent-1" />);
    const props = calendarSpy.mock.calls[0][0];

    expect(props.selectable).toBe(false);
    expect(props.onSelectSlot).toBeUndefined();
  });

  it('enables slot selection when a work item context and update permission are present', async () => {
    render(
      <AgentScheduleView
        agentId="agent-1"
        workItemContext={{ workItemId: 'ticket-1', workItemType: 'ticket', title: 'Printer offline' }}
      />
    );

    await waitFor(() => {
      const props = calendarSpy.mock.calls.at(-1)[0];
      expect(props.selectable).toBe(true);
      expect(typeof props.onSelectSlot).toBe('function');
    });
  });

  it('keeps selection disabled for a work item context without update permission', async () => {
    getCurrentUserPermissions.mockResolvedValue(['user_schedule:read:all']);

    render(
      <AgentScheduleView
        agentId="agent-1"
        workItemContext={{ workItemId: 'ticket-1', workItemType: 'ticket', title: 'Printer offline' }}
      />
    );

    await waitFor(() => expect(getScheduleEntries).toHaveBeenCalled());

    const props = calendarSpy.mock.calls.at(-1)[0];
    expect(props.selectable).toBe(false);
    expect(props.onSelectSlot).toBeUndefined();
  });

  it('creates a ticket-scoped entry when a slot is selected and saved', async () => {
    const onScheduled = vi.fn();
    const { getByTestId } = render(
      <AgentScheduleView
        agentId="agent-1"
        workItemContext={{
          workItemId: 'ticket-1',
          workItemType: 'ticket',
          title: 'Printer offline',
          onScheduled,
        }}
      />
    );

    await waitFor(() =>
      expect(typeof calendarSpy.mock.calls.at(-1)[0].onSelectSlot).toBe('function')
    );

    const calendarProps = calendarSpy.mock.calls.at(-1)[0];
    act(() => {
      calendarProps.onSelectSlot({
        start: new Date('2026-01-05T10:00:00Z'),
        end: new Date('2026-01-05T10:30:00Z'),
        slots: [],
        action: 'select',
      });
    });

    await waitFor(() => expect(getByTestId('entry-popup')).toBeTruthy());

    const popupProps = entryPopupSpy.mock.calls.at(-1)[0];
    expect(popupProps.viewOnly).toBe(false);
    // Dialog presentation keeps the creation form visible above the calendar.
    expect(popupProps.isInDrawer).toBe(false);
    expect(popupProps.initialWorkItem).toMatchObject({
      work_item_id: 'ticket-1',
      type: 'ticket',
      name: 'Printer offline',
    });
    expect(popupProps.slot.start).toEqual(new Date('2026-01-05T10:00:00Z'));
    expect(popupProps.slot.end).toEqual(new Date('2026-01-05T10:30:00Z'));
    expect(popupProps.slot.assigned_user_ids).toEqual(['agent-1']);
    // The drawer only refetches the viewed agent, so reassigning here would
    // make the saved entry vanish; the assignee stays locked to that agent.
    expect(popupProps.canAssignOthers).toBe(false);

    await act(async () => {
      await popupProps.onSave({
        entry_id: '',
        title: 'Printer offline',
        scheduled_start: popupProps.slot.start,
        scheduled_end: popupProps.slot.end,
        notes: '',
        created_at: new Date(),
        updated_at: new Date(),
        work_item_id: 'ticket-1',
        status: 'scheduled',
        work_item_type: 'ticket',
        assigned_user_ids: ['agent-1'],
        is_private: false,
        recurrence_pattern: null,
      });
    });

    expect(addScheduleEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        work_item_id: 'ticket-1',
        work_item_type: 'ticket',
        assigned_user_ids: ['agent-1'],
        scheduled_start: new Date('2026-01-05T10:00:00Z'),
        scheduled_end: new Date('2026-01-05T10:30:00Z'),
      })
    );
    expect(onScheduled).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Scheduled Printer offline');
  });

  it('shows the work item header with a selection hint when the user can schedule', async () => {
    const { findByText } = render(
      <AgentScheduleView
        agentId="agent-1"
        workItemContext={{ workItemId: 'ticket-1', workItemType: 'ticket', title: 'Printer offline' }}
      />
    );

    expect(await findByText('Printer offline')).toBeTruthy();
    expect(await findByText(/Click or drag a time on the calendar/)).toBeTruthy();
  });

  it('explains the read-only calendar when the user lacks update permission', async () => {
    getCurrentUserPermissions.mockResolvedValueOnce(['user_schedule:read:all']);
    const { findByText } = render(
      <AgentScheduleView
        agentId="agent-1"
        workItemContext={{ workItemId: 'ticket-1', workItemType: 'ticket', title: 'Printer offline' }}
      />
    );

    expect(await findByText(/need the schedule update permission/)).toBeTruthy();
  });

  it('renders no work item header without a work item context', async () => {
    const { queryByText } = render(<AgentScheduleView agentId="agent-1" />);
    await waitFor(() => expect(calendarSpy).toHaveBeenCalled());
    expect(queryByText(/Click or drag a time on the calendar/)).toBeNull();
  });

  it('pins month-view slots to 8am for 15 minutes', async () => {
    const { getByTestId } = render(
      <AgentScheduleView
        agentId="agent-1"
        workItemContext={{ workItemId: 'ticket-1', workItemType: 'ticket', title: 'Printer offline' }}
      />
    );

    await waitFor(() =>
      expect(typeof calendarSpy.mock.calls.at(-1)[0].onSelectSlot).toBe('function')
    );

    const initialProps = calendarSpy.mock.calls.at(-1)[0];
    act(() => {
      initialProps.onView('month');
    });

    const monthProps = calendarSpy.mock.calls.at(-1)[0];
    act(() => {
      monthProps.onSelectSlot({
        start: new Date(2026, 0, 5),
        end: new Date(2026, 0, 6),
        slots: [],
        action: 'select',
      });
    });

    await waitFor(() => expect(getByTestId('entry-popup')).toBeTruthy());

    const popupProps = entryPopupSpy.mock.calls.at(-1)[0];
    expect(popupProps.slot.start.getHours()).toBe(8);
    expect(popupProps.slot.start.getMinutes()).toBe(0);
    expect(popupProps.slot.end.getTime() - popupProps.slot.start.getTime()).toBe(15 * 60 * 1000);
  });
});
