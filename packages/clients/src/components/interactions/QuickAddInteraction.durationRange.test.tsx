/* @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  addInteraction: vi.fn(),
  updateInteraction: vi.fn(),
  t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'creator' } } }) }));
vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({ useTenant: () => 'tenant' }));
vi.mock('../../context/ClientCrossFeatureContext', () => ({ useOptionalClientCrossFeature: () => null }));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUserPermissions: mocks.permissions,
  getUserAvatarUrlsBatchAction: vi.fn(),
}));
vi.mock('../../lib/usersHelpers', () => ({ getAllUsersBasicAsync: mocks.users }));
vi.mock('@alga-psa/clients/actions', () => ({
  getAllInteractionTypes: async () => [{ type_id: 'call', type_name: 'Call' }],
  getInteractionStatuses: async () => [{ status_id: 'open', name: 'Open', is_default: true }],
  getAllClients: async () => [],
  getAllContacts: async () => [],
  getClientById: async () => null,
  getInteractionById: async () => ({ interaction_id: 'interaction' }),
  addInteraction: mocks.addInteraction,
  updateInteraction: mocks.updateInteraction,
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@alga-psa/ui/components/skeletons/RichTextEditorSkeleton', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/InteractionIcon', () => ({ default: () => null }));
vi.mock('../contacts/QuickAddContact', () => ({ default: () => null }));
vi.mock('../clients/QuickAddClient', () => ({ default: () => null }));
vi.mock('./MeetingAttendeesPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: ChildrenProps) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: { id: string }) => ({ automationIdProps: { id } }),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, onClose, children, footer }: DialogProps) => isOpen ? (
    <div><button onClick={onClose}>Close dialog</button>{children}{footer}</div>
  ) : null,
  DialogContent: ({ children }: ChildrenProps) => <>{children}</>,
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
      <option value="creator">Creator</option>
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/MultiUserPicker', () => ({
  default: ({ values, onValuesChange, label }: MultiPickerProps) => (
    <select multiple aria-label={label} value={values}
      onChange={(event) => onValuesChange(Array.from(event.target.selectedOptions, (option) => option.value))}>
      <option value="creator">Creator</option>
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, label }: SwitchProps) => (
    <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
  ),
}));
vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ label, value, onChange }: DatePickerProps) => (
    <input aria-label={label} value={value?.toISOString() ?? ''}
      onChange={(event) => onChange(event.target.value ? new Date(event.target.value) : undefined)} />
  ),
}));

import { QuickAddInteraction } from './QuickAddInteraction';

const TOO_LONG = "Interactions can't be longer than 24 hours.";
const START = '2026-10-01T09:00:00.000Z';

const props = {
  entityId: 'client', entityType: 'client' as const,
  isOpen: true, onClose: vi.fn(), onInteractionAdded: vi.fn(),
};

const hoursField = () => screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
const minutesField = () => screen.getAllByRole('spinbutton')[1] as HTMLInputElement;
const startField = () => screen.getByRole('textbox', { name: 'Start Time' });
const endField = () => screen.getByRole('textbox', { name: 'End Time' });

async function openCreateForm() {
  render(<QuickAddInteraction {...props} />);
  await screen.findByRole('option', { name: 'Call' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Select Interaction Type' }), { target: { value: 'call' } });
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Follow-up' } });
  fireEvent.change(startField(), { target: { value: START } });
}

describe('QuickAddInteraction duration/range agreement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions.mockResolvedValue([]);
    mocks.users.mockResolvedValue([]);
    mocks.addInteraction.mockResolvedValue({ interaction_id: 'interaction' });
    mocks.updateInteraction.mockResolvedValue({ interaction_id: 'interaction-1' });
  });

  it('refuses an end time 72 hours after the start and never submits a mismatch', async () => {
    await openCreateForm();

    fireEvent.change(endField(), { target: { value: '2026-10-04T09:00:00.000Z' } });

    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    // The picked end time stays visible (flagged, not dropped), but the duration fields
    // do not drift into the 72 hours the submitted duration would then clamp down to 24.
    expect(endField()).toHaveValue('2026-10-04T09:00:00.000Z');
    expect(hoursField()).toHaveValue(null);
    expect(minutesField()).toHaveValue(null);

    fireEvent.click(screen.getByRole('button', { name: 'Save Interaction' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Interaction' })).toBeDisabled());
    expect(mocks.addInteraction).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('submits a sub-cap range with a duration that matches it', async () => {
    await openCreateForm();

    fireEvent.change(endField(), { target: { value: '2026-10-01T12:00:00.000Z' } });

    expect(hoursField()).toHaveValue(3);
    expect(minutesField()).toHaveValue(null);
    expect(screen.queryByText(TOO_LONG)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save Interaction' }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(mocks.addInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: 180,
        start_time: new Date(START),
        end_time: new Date('2026-10-01T12:00:00.000Z'),
      }),
      expect.anything(),
    );
  });

  it('flags a start time that pushes the existing end beyond the cap', async () => {
    await openCreateForm();
    fireEvent.change(endField(), { target: { value: '2026-10-01T12:00:00.000Z' } });
    expect(hoursField()).toHaveValue(3);

    // Clearing the duration hands the start-time handler its date-difference branch.
    fireEvent.change(hoursField(), { target: { value: '' } });
    fireEvent.change(startField(), { target: { value: '2026-09-20T09:00:00.000Z' } });

    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    expect(hoursField()).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Save Interaction' })).toBeDisabled();
  });

  it('forces an edit of a stored 72-hour row to reconcile before it can be saved', async () => {
    const editingInteraction = {
      interaction_id: 'interaction-1',
      type_id: 'call',
      type_name: 'Call',
      title: 'Marathon call',
      status_id: 'open',
      user_id: 'creator',
      client_id: 'client',
      contact_name_id: null,
      duration: 1440,
      start_time: new Date(START),
      end_time: new Date('2026-10-04T09:00:00.000Z'),
    } as any;

    render(<QuickAddInteraction {...props} editingInteraction={editingInteraction} />);
    await screen.findByRole('option', { name: 'Call' });

    // The stored mismatch is visible and blocks the save until the range is fixed.
    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Update Interaction' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(mocks.updateInteraction).not.toHaveBeenCalled();

    fireEvent.change(endField(), { target: { value: '2026-10-01T11:00:00.000Z' } });
    expect(screen.queryByText(TOO_LONG)).toBeNull();
    expect(hoursField()).toHaveValue(2);

    fireEvent.click(screen.getByRole('button', { name: 'Update Interaction' }));

    await waitFor(() => expect(mocks.updateInteraction).toHaveBeenCalledOnce());
    expect(mocks.updateInteraction).toHaveBeenCalledWith('interaction-1', expect.objectContaining({
      duration: 120,
      start_time: new Date(START),
      end_time: new Date('2026-10-01T11:00:00.000Z'),
    }));
  });

  it('shows and saves the range when a stored sub-cap duration disagrees with it', async () => {
    render(<QuickAddInteraction {...props} editingInteraction={{
      interaction_id: 'interaction-1',
      type_id: 'call',
      type_name: 'Call',
      title: 'Quick call',
      status_id: 'open',
      user_id: 'creator',
      client_id: 'client',
      contact_name_id: null,
      // Legacy row: 90 minutes logged against a 30-minute window.
      duration: 90,
      start_time: new Date(START),
      end_time: new Date('2026-10-01T09:30:00.000Z'),
    } as any} />);
    await screen.findByRole('option', { name: 'Call' });

    // The range is authoritative, so the user sees what saving will store.
    expect(hoursField()).toHaveValue(null);
    expect(minutesField()).toHaveValue(30);
    expect(screen.queryByText(TOO_LONG)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Update Interaction' }));

    await waitFor(() => expect(mocks.updateInteraction).toHaveBeenCalledOnce());
    expect(mocks.updateInteraction).toHaveBeenCalledWith('interaction-1', expect.objectContaining({
      duration: 30,
      start_time: new Date(START),
      end_time: new Date('2026-10-01T09:30:00.000Z'),
    }));
  });

  it('rejects an over-cap range submitted around the disabled save button', async () => {
    // Submitting the form itself (Enter in a field) bypasses the disabled footer button,
    // so handleSubmit carries its own guard.
    render(<QuickAddInteraction {...props} editingInteraction={{
      interaction_id: 'interaction-1',
      type_id: 'call',
      type_name: 'Call',
      title: 'Marathon call',
      status_id: 'open',
      user_id: 'creator',
      client_id: 'client',
      contact_name_id: null,
      duration: 1440,
      start_time: new Date(START),
      end_time: new Date('2026-10-04T09:00:00.000Z'),
    } as any} />);
    await screen.findByRole('option', { name: 'Call' });

    fireEvent.submit(document.getElementById('quick-add-interaction-form')!);

    // Once inline and once in the submit-time validation summary.
    await waitFor(() => expect(screen.getAllByText(TOO_LONG)).toHaveLength(2));
    expect(mocks.updateInteraction).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
