/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ChildrenProps = { children?: React.ReactNode };
type ValuePickerProps = { value: string; onValueChange: (value: string) => void };
type SelectProps = ValuePickerProps & {
  options: { value: string; textValue?: string; label: React.ReactNode }[];
  placeholder: string;
};
type MultiPickerProps = { values: string[]; onValuesChange: (values: string[]) => void; label: string };
type SwitchProps = { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string };
type DatePickerProps = { label: string; value?: Date; onChange: (date?: Date) => void };
type DialogProps = ChildrenProps & { isOpen: boolean; onClose: () => void; footer: React.ReactNode };
type ButtonProps = ChildrenProps & {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
};

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(),
  users: vi.fn(),
  contacts: vi.fn(),
  addInteraction: vi.fn(),
  teams: {
    getTeamsMeetingCapability: vi.fn(),
    scheduleTeamsMeeting: vi.fn(),
  },
  t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/lib/i18n/client')>()),
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'creator' } } }) }));
vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({ useTenant: () => 'tenant' }));
vi.mock('../../context/ClientCrossFeatureContext', () => ({ useOptionalClientCrossFeature: () => mocks.teams }));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUserPermissions: mocks.permissions,
  getUserAvatarUrlsBatchAction: vi.fn(),
}));
vi.mock('../../lib/usersHelpers', () => ({ getAllUsersBasicAsync: mocks.users }));
vi.mock('@alga-psa/clients/actions', () => ({
  getAllInteractionTypes: async () => [
    { type_id: 'call', type_name: 'Call' },
    { type_id: 'online', type_name: 'Online Meeting' },
  ],
  getInteractionStatuses: async () => [{ status_id: 'open', name: 'Open', is_default: true }],
  getAllClients: async () => [],
  getAllContacts: mocks.contacts,
  getClientById: async () => null,
  getInteractionById: async () => ({ interaction_id: 'interaction' }),
  addInteraction: mocks.addInteraction,
  updateInteraction: vi.fn(),
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@alga-psa/ui/components/skeletons/RichTextEditorSkeleton', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/InteractionIcon', () => ({ default: () => null }));
vi.mock('../contacts/QuickAddContact', () => ({ default: () => null }));
vi.mock('../clients/QuickAddClient', () => ({ default: () => null }));
vi.mock('./MeetingAttendeesPicker', () => ({
  default: ({ defaultAttendees }: { defaultAttendees?: { emailAddress: string }[] }) => (
    <div data-testid="meeting-attendee-defaults">
      {(defaultAttendees ?? []).map((attendee) => attendee.emailAddress).join(',')}
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: ChildrenProps) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: { id: string }) => ({ automationIdProps: { id }, updateMetadata: () => {} }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, type, disabled }: ButtonProps) => (
    <button onClick={onClick} type={type} disabled={disabled}>{children}</button>
  ),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: ChildrenProps) => <div>{children}</div>,
  AlertDescription: ({ children }: ChildrenProps) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ value, onValueChange, options, placeholder }: SelectProps) => (
    <select aria-label={placeholder} value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="" />
      {options.map((option) => <option key={option.value} value={option.value}>{option.textValue ?? option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  default: ({ value, onValueChange }: ValuePickerProps) => (
    <select aria-label="Owner" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="creator">Creator</option><option value="colleague">Colleague</option>
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/MultiUserPicker', () => ({
  default: ({ values, onValuesChange, label }: MultiPickerProps) => (
    <select multiple aria-label={label} value={values}
      onChange={(event) => onValuesChange(Array.from(event.target.selectedOptions, (option) => option.value))}>
      <option value="creator">Creator</option><option value="colleague">Colleague</option>
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, label }: SwitchProps) => (
    <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
  ),
}));

import { QuickAddInteraction } from './QuickAddInteraction';

/**
 * alga-2026-0002591: the real Dialog and the real DateTimePicker, driven with
 * pointer events. Only the data layer and the unrelated pickers are stubbed.
 */

const props = {
  entityId: 'client', entityType: 'client' as const, ticketId: 'ticket',
  isOpen: true, onClose: vi.fn(), onInteractionAdded: vi.fn(),
};

// "Now" is deliberately not midnight and has seconds: the dialog seeds Start with it.
const NOW = new Date(2026, 8, 10, 15, 47, 23);

const timeInput = (label: 'Start Time' | 'End Time') =>
  screen.getAllByRole('combobox', { name: 'Select time' })[label === 'Start Time' ? 0 : 1] as HTMLInputElement;
const dateInput = (label: 'Start Time' | 'End Time') =>
  screen.getByRole('combobox', { name: label }) as HTMLInputElement;

async function pickDay(user: ReturnType<typeof userEvent.setup>, label: 'Start Time' | 'End Time', day: string) {
  await user.click(dateInput(label));
  const panel = await screen.findByRole('dialog', { name: label });
  const cell = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent === day && !b.disabled);
  if (!cell) throw new Error(`no enabled day ${day}`);
  await user.click(cell);
}

async function pickRailTime(user: ReturnType<typeof userEvent.setup>, label: 'Start Time' | 'End Time', name: string) {
  await user.click(await screen.findByRole('option', { name }));
  expect(timeInput(label).value).toBe(name);
}

async function typeTime(user: ReturnType<typeof userEvent.setup>, label: 'Start Time' | 'End Time', text: string) {
  const input = timeInput(label);
  // After a day pick the time half is already focused; a click on a focused input only moves the caret.
  if (document.activeElement !== input) await user.click(input);
  // focusField selects the text on the next frame; typing before that would be swallowed.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await user.keyboard(`{Control>}a{/Control}${text}{Enter}`);
}

async function save() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Select Interaction Type' }), { target: { value: 'call' } });
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Follow-up' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Interaction' }));
  await waitFor(() => expect(mocks.addInteraction).toHaveBeenCalledOnce());
  return mocks.addInteraction.mock.calls[0] as [
    { start_time: Date; end_time: Date },
    { createScheduleEntry: boolean },
  ];
}

describe('QuickAddInteraction start/end pickers inside the real Dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    mocks.permissions.mockResolvedValue([]);
    mocks.users.mockResolvedValue([]);
    mocks.contacts.mockResolvedValue([]);
    mocks.addInteraction.mockResolvedValue({ interaction_id: 'interaction' });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function open() {
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<QuickAddInteraction {...props} />);
    await screen.findByRole('option', { name: 'Call' });
    return user;
  }

  it('saves the non-midnight times picked from the rail after a day pick', async () => {
    const user = await open();

    await pickDay(user, 'Start Time', '17');
    await pickRailTime(user, 'Start Time', '9:15 AM');
    await pickDay(user, 'End Time', '17');
    await pickRailTime(user, 'End Time', '10:45 AM');
    expect(timeInput('Start Time').value).toBe('9:15 AM');

    const [data, options] = await save();
    expect(data.start_time).toEqual(new Date(2026, 8, 17, 9, 15));
    expect(data.end_time).toEqual(new Date(2026, 8, 17, 10, 45));
    // The schedule entry is booked from this same start_time/end_time payload.
    expect(options.createScheduleEntry).toBe(true);
  });

  it('saves times typed into the time half after a day pick', async () => {
    const user = await open();

    await pickDay(user, 'Start Time', '17');
    await typeTime(user, 'Start Time', '9:37 AM');
    await pickDay(user, 'End Time', '17');
    await typeTime(user, 'End Time', '11:08 AM');

    expect(timeInput('Start Time').value).toBe('9:37 AM');
    expect(timeInput('End Time').value).toBe('11:08 AM');
    const [data] = await save();
    expect(data.start_time).toEqual(new Date(2026, 8, 17, 9, 37));
    expect(data.end_time).toEqual(new Date(2026, 8, 17, 11, 8));
  });

  it('keeps an End that is earlier than Start, flags it, and accepts it once Start moves', async () => {
    const user = await open();

    await pickDay(user, 'Start Time', '17');
    await pickRailTime(user, 'Start Time', '9:15 AM');
    await pickDay(user, 'End Time', '17');
    await pickRailTime(user, 'End Time', '8:00 AM');

    // The picker shows 8:00 AM, so the dialog must hold it (it used to drop it silently).
    expect(timeInput('End Time').value).toBe('8:00 AM');
    expect(screen.getByText('End time must be on or after the start time.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save Interaction' }) as HTMLButtonElement).disabled).toBe(true);

    await pickDay(user, 'Start Time', '17');
    await pickRailTime(user, 'Start Time', '7:30 AM');
    expect(timeInput('End Time').value).toBe('8:00 AM');
    expect(screen.queryByText('End time must be on or after the start time.')).toBeNull();

    const [data] = await save();
    expect(data.start_time).toEqual(new Date(2026, 8, 17, 7, 30));
    expect(data.end_time).toEqual(new Date(2026, 8, 17, 8, 0));
  });

  it('accepts an End on the same minute as the seeded Start (which carries no seconds)', async () => {
    const user = await open();

    await pickDay(user, 'End Time', '10');
    await typeTime(user, 'End Time', '3:47 PM');

    expect(screen.queryByText('End time must be on or after the start time.')).toBeNull();
    const [data] = await save();
    expect(data.start_time).toEqual(new Date(2026, 8, 10, 15, 47, 0, 0));
    expect(data.end_time).toEqual(new Date(2026, 8, 10, 15, 47, 0, 0));
  });
});
