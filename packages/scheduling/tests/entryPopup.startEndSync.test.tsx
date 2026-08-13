/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryPopup from '../src/components/schedule/EntryPopup';

/**
 * Moving Start past End left an appointment that finished before it began, and
 * the dialog said nothing until submit — so the end time had to be re-picked
 * from scratch every time. Start now drags the end along, and the mismatch is
 * called out inline.
 */

const {
  getTeamsMeetingCapability,
  getAppointmentRequestById,
  approveAppointmentRequest,
  declineAppointmentRequest,
  getWorkItemById,
  getUserAvatarUrlsBatchAction,
} = vi.hoisted(() => ({
  getTeamsMeetingCapability: vi.fn(),
  getAppointmentRequestById: vi.fn(),
  approveAppointmentRequest: vi.fn(),
  declineAppointmentRequest: vi.fn(),
  getWorkItemById: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  approveAppointmentRequest,
  declineAppointmentRequest,
  getTeamsMeetingCapability,
  getAppointmentRequestById,
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
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
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

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
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

const slot = {
  start: new Date('2026-08-12T14:00:00.000Z'),
  end: new Date('2026-08-12T14:15:00.000Z'),
};

// An hour-long entry, the shape you get by dragging out a default slot. The
// picker commits on every hour/minute/period click, so reaching 14:35 from here
// walks through intermediate times that must not redefine how long it is.
const hourLongSlot = {
  start: new Date('2026-08-12T10:15:00.000Z'),
  end: new Date('2026-08-12T11:15:00.000Z'),
};

const END_AFTER_START = 'End date must be after start date';

const renderPopup = (activeSlot: typeof slot = slot, onSave = vi.fn()) => ({
  onSave,
  ...render(
    <EntryPopup
      event={null}
      slot={activeSlot}
      onClose={vi.fn()}
      onSave={onSave}
      canAssignMultipleAgents={false}
      users={[] as any}
      currentUserId="tech-1"
      canModifySchedule={true}
      focusedTechnicianId={null}
      canAssignOthers={true}
    />
  ),
});

const setPicker = (testId: string, iso: string) => {
  fireEvent.change(screen.getByTestId(testId), { target: { value: iso } });
};

describe('EntryPopup start/end synchronisation', () => {
  beforeEach(() => {
    getTeamsMeetingCapability.mockResolvedValue({ available: false });
    getAppointmentRequestById.mockResolvedValue({ success: false });
    getWorkItemById.mockResolvedValue(null);
    getUserAvatarUrlsBatchAction.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shifts the end forward, keeping the duration, when the start passes it', () => {
    renderPopup();

    setPicker('scheduled_start', '2026-08-12T14:35:00.000Z');

    expect((screen.getByTestId('scheduled_end') as HTMLInputElement).value)
      .toBe('2026-08-12T14:50:00.000Z');
    expect(screen.queryByText(END_AFTER_START)).toBeNull();
  });

  it('warns inline while the end is not after the start, without waiting for submit', () => {
    renderPopup();

    setPicker('scheduled_end', '2026-08-12T13:45:00.000Z');

    expect(screen.getByText(END_AFTER_START)).toBeTruthy();

    setPicker('scheduled_end', '2026-08-12T15:20:00.000Z');

    expect(screen.queryByText(END_AFTER_START)).toBeNull();
  });

  // Deriving the duration from whatever the fields happened to show meant the
  // half-built times the hour/minute/period buttons pass through — 02:35 on the
  // way to 14:35 — were read as the intended length, and the end landed hours
  // out.
  it.each([
    ['hour, minute, then period', ['02:15', '02:35', '14:35']],
    ['period, hour, then minute', ['22:15', '14:15', '14:35']],
  ])('keeps the hour-long duration when the start is built %s', (_name, steps) => {
    renderPopup(hourLongSlot);

    for (const time of steps) {
      setPicker('scheduled_start', `2026-08-12T${time}:00.000Z`);
    }

    expect((screen.getByTestId('scheduled_end') as HTMLInputElement).value)
      .toBe('2026-08-12T15:35:00.000Z');
    expect(screen.queryByText(END_AFTER_START)).toBeNull();
  });

  it('adopts a new duration once the end itself is edited', () => {
    renderPopup(hourLongSlot);

    setPicker('scheduled_end', '2026-08-12T12:45:00.000Z');
    setPicker('scheduled_start', '2026-08-12T14:35:00.000Z');

    // Two and a half hours, as the edited end asked for — not the original one.
    expect((screen.getByTestId('scheduled_end') as HTMLInputElement).value)
      .toBe('2026-08-12T17:05:00.000Z');
  });

  it('refuses to save an entry that ends before it starts', () => {
    const { onSave, container } = renderPopup();

    fireEvent.change(container.querySelector('#title') as HTMLInputElement, {
      target: { name: 'title', value: 'Onsite visit' },
    });
    setPicker('scheduled_end', '2026-08-12T13:45:00.000Z');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Please fill in the required fields:')).toBeTruthy();
    // Once inline under the pickers, once in the submit summary.
    expect(screen.getAllByText(END_AFTER_START)).toHaveLength(2);
  });
});
