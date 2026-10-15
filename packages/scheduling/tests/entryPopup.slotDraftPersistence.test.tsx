/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EntryPopup from '../src/components/schedule/EntryPopup';

/**
 * The editor opens on a freshly clicked slot, and the host keeps re-rendering
 * (Technician list, viewer permissions) with a rebuilt slot object. Initializing
 * off the object's identity wiped whatever the user had typed. These tests hold
 * the slot semantics constant while the host re-renders, so only a real target
 * change may re-initialize the draft.
 */

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

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
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

const SLOT_START = new Date('2026-01-05T10:00:00Z');
const SLOT_END = new Date('2026-01-05T11:00:00Z');

/**
 * Mirrors WorkItemEntryEditor: the slot prop is rebuilt on every host render,
 * and the Technician list arrives asynchronously after the editor is open.
 */
function DraftHarness({ onSave, initialTitle }: { onSave: (data: any) => void; initialTitle: string }) {
  const [users, setUsers] = React.useState<any[]>([]);
  React.useEffect(() => {
    const timer = setTimeout(
      () => setUsers([{ user_id: 'tech-1', first_name: 'Tess', last_name: 'Tech' }]),
      25
    );
    return () => clearTimeout(timer);
  }, []);

  return (
    <div>
      <span data-testid="users-loaded">{users.length}</span>
      <EntryPopup
        event={null}
        slot={{ start: SLOT_START, end: SLOT_END, assigned_user_ids: ['tech-1'] }}
        initialWorkItem={{ work_item_id: 'ticket-1', type: 'ticket', name: initialTitle }}
        onClose={() => {}}
        onSave={onSave}
        canAssignMultipleAgents={false}
        users={users}
        currentUserId="tech-1"
        canModifySchedule={true}
        focusedTechnicianId="tech-1"
        canAssignOthers={false}
      />
    </div>
  );
}

describe('EntryPopup draft persistence across async host rerenders', () => {
  beforeEach(() => {
    getTeamsMeetingCapability.mockResolvedValue({ available: false });
    getAppointmentRequestById.mockResolvedValue({ success: false });
    getScheduleEntryTeamsMeeting.mockResolvedValue({ success: true, data: null });
    getWorkItemById.mockResolvedValue(null);
    getUserAvatarUrlsBatchAction.mockResolvedValue({});
  });

  it('keeps a typed title when async data arrives after the editor opened', async () => {
    const onSave = vi.fn();
    render(<DraftHarness onSave={onSave} initialTitle="Printer offline" />);

    const title = document.getElementById('title') as HTMLInputElement;
    expect(title.value).toBe('Printer offline');

    fireEvent.change(title, { target: { value: 'Server room walkthrough' } });
    expect(title.value).toBe('Server room walkthrough');

    await waitFor(() => expect(screen.getByTestId('users-loaded').textContent).toBe('1'));

    expect((document.getElementById('title') as HTMLInputElement).value).toBe('Server room walkthrough');
  });

  it('saves the typed title, not the work item default, after async data arrives', async () => {
    const onSave = vi.fn();
    render(<DraftHarness onSave={onSave} initialTitle="Printer offline" />);

    fireEvent.change(document.getElementById('title') as HTMLInputElement, {
      target: { value: 'Server room walkthrough' },
    });

    await waitFor(() => expect(screen.getByTestId('users-loaded').textContent).toBe('1'));

    fireEvent.click(document.getElementById('save-entry-btn') as HTMLButtonElement);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: 'Server room walkthrough',
      scheduled_start: SLOT_START,
      scheduled_end: SLOT_END,
    });
  });

  it('re-initializes when the target slot actually moves', async () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <EntryPopup
        event={null}
        slot={{ start: SLOT_START, end: SLOT_END, assigned_user_ids: ['tech-1'] }}
        initialWorkItem={{ work_item_id: 'ticket-1', type: 'ticket', name: 'Printer offline' }}
        onClose={() => {}}
        onSave={onSave}
        canAssignMultipleAgents={false}
        users={[]}
        currentUserId="tech-1"
        canModifySchedule={true}
        focusedTechnicianId="tech-1"
        canAssignOthers={false}
      />
    );

    fireEvent.change(document.getElementById('title') as HTMLInputElement, {
      target: { value: 'Draft for the first slot' },
    });

    const movedStart = new Date('2026-01-05T13:00:00Z');
    const movedEnd = new Date('2026-01-05T14:00:00Z');
    rerender(
      <EntryPopup
        event={null}
        slot={{ start: movedStart, end: movedEnd, assigned_user_ids: ['tech-1'] }}
        initialWorkItem={{ work_item_id: 'ticket-1', type: 'ticket', name: 'Printer offline' }}
        onClose={() => {}}
        onSave={onSave}
        canAssignMultipleAgents={false}
        users={[]}
        currentUserId="tech-1"
        canModifySchedule={true}
        focusedTechnicianId="tech-1"
        canAssignOthers={false}
      />
    );

    const start = document.getElementById('scheduled_start') as HTMLInputElement;
    expect(new Date(start.value).toISOString()).toBe(movedStart.toISOString());
  });
});

describe('EntryPopup linked work item loading', () => {
  it.each([true, false])('shows a skeleton until the linked ticket resolves (viewOnly=%s)', async (viewOnly) => {
    let resolveWorkItem!: (value: any) => void;
    getWorkItemById.mockReturnValueOnce(new Promise((resolve) => { resolveWorkItem = resolve; }));
    render(<EntryPopup
      event={{ entry_id: 'entry-1', title: 'Printer offline', work_item_id: 'ticket-1', work_item_type: 'ticket', scheduled_start: SLOT_START, scheduled_end: SLOT_END, assigned_user_ids: ['tech-1'] } as any}
      onClose={() => {}} onSave={vi.fn()} canAssignMultipleAgents={false} users={[]} currentUserId="tech-1"
      canModifySchedule={!viewOnly} viewOnly={viewOnly}
    />);
    expect(screen.queryByText('Ad-hoc entry (no work item)')).toBeNull();
    const loading = screen.getByRole('status', { name: 'Loading work item…' });
    expect(loading.className).toContain('skeleton-fill');
    await act(async () => { resolveWorkItem({ work_item_id: 'ticket-1', type: 'ticket', name: 'Printer offline' }); });
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading work item…' })).toBeNull());
  });
});
