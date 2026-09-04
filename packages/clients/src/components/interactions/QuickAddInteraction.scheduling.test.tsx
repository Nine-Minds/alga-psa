/* @vitest-environment jsdom */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  teams: {
    getTeamsMeetingCapability: vi.fn(),
    scheduleTeamsMeeting: vi.fn(),
  },
  t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: mocks.t }) }));
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
  getAllContacts: async () => [],
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
vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ label, value, onChange }: DatePickerProps) => (
    <input aria-label={label} value={value?.toISOString() ?? ''}
      onChange={(event) => onChange(event.target.value ? new Date(event.target.value) : undefined)} />
  ),
}));

import { QuickAddInteraction } from './QuickAddInteraction';

function deferredPermissions() {
  let resolve!: (permissions: string[]) => void;
  const promise = new Promise<string[]>((res) => { resolve = res; });
  return { promise, resolve };
}

const props = {
  entityId: 'client', entityType: 'client' as const, ticketId: 'ticket',
  isOpen: true, onClose: vi.fn(), onInteractionAdded: vi.fn(),
};

async function enableScheduling() {
  await screen.findByRole('option', { name: 'Call' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add to schedule' }));
}

describe('QuickAddInteraction scheduling lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions.mockResolvedValue(['user_schedule:update']);
    mocks.users.mockResolvedValue([]);
    mocks.addInteraction.mockResolvedValue({ interaction_id: 'interaction' });
    mocks.teams.getTeamsMeetingCapability.mockResolvedValue({ available: true });
  });

  it.each(['Cancel', 'Close dialog', 'parent'])('resets scheduling after %s and waits for fresh permissions', async (closeMethod) => {
    const view = render(<QuickAddInteraction {...props} />);
    await enableScheduling();
    expect(await screen.findByRole('listbox', { name: 'Schedule for' })).toHaveValue(['creator']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'colleague' } });
    expect(screen.getByRole('listbox', { name: 'Schedule for' })).toHaveValue(['colleague']);

    if (closeMethod !== 'parent') fireEvent.click(screen.getByRole('button', { name: closeMethod }));
    view.rerender(<QuickAddInteraction {...props} isOpen={false} />);
    const nextPermissions = deferredPermissions();
    mocks.permissions.mockReturnValueOnce(nextPermissions.promise);
    view.rerender(<QuickAddInteraction {...props} />);
    expect(screen.getByRole('checkbox', { name: 'Add to schedule' })).not.toBeChecked();
    await enableScheduling();
    expect(screen.queryByRole('listbox', { name: 'Schedule for' })).toBeNull();
    await act(async () => nextPermissions.resolve(['user_schedule:update']));
    expect(screen.getByRole('listbox', { name: 'Schedule for' })).toHaveValue(['creator']);
    expect(mocks.permissions).toHaveBeenCalledTimes(2);
    expect(mocks.users).toHaveBeenCalledTimes(2);
    expect(mocks.users).toHaveBeenLastCalledWith(false, 'internal');
  });

  it('ignores a permission response from an abandoned dialog', async () => {
    const oldPermissions = deferredPermissions();
    const nextPermissions = deferredPermissions();
    mocks.permissions.mockReturnValueOnce(oldPermissions.promise).mockReturnValueOnce(nextPermissions.promise);
    const view = render(<QuickAddInteraction {...props} />);
    await enableScheduling();
    view.rerender(<QuickAddInteraction {...props} isOpen={false} />);
    view.rerender(<QuickAddInteraction {...props} />);
    await enableScheduling();
    await act(async () => oldPermissions.resolve(['user_schedule:update']));
    expect(screen.queryByRole('listbox', { name: 'Schedule for' })).toBeNull();
    await act(async () => nextPermissions.resolve([]));
    expect(screen.queryByRole('listbox', { name: 'Schedule for' })).toBeNull();
  });

  it('resets scheduling after a successful submit', async () => {
    const view = render(<QuickAddInteraction {...props} />);
    await enableScheduling();
    fireEvent.change(screen.getByRole('combobox', { name: 'Select Interaction Type' }), { target: { value: 'call' } });
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Follow-up' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'colleague' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Interaction' }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(mocks.addInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'colleague', ticket_id: 'ticket' }),
      { createScheduleEntry: true, scheduleAssignedUserIds: ['colleague'] },
    );
    view.rerender(<QuickAddInteraction {...props} isOpen={false} />);
    mocks.permissions.mockReturnValueOnce(new Promise(() => {}));
    view.rerender(<QuickAddInteraction {...props} />);
    await enableScheduling();
    expect(screen.queryByRole('listbox', { name: 'Schedule for' })).toBeNull();
  });

  it('describes the selected calendars in the Teams summary', async () => {
    render(<QuickAddInteraction {...props} />);
    await screen.findByRole('option', { name: 'Online Meeting' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Select Interaction Type' }), { target: { value: 'online' } });
    await screen.findByRole('listbox', { name: 'Schedule for' });
    const summary = document.getElementById('quick-add-interaction-meeting-summary');
    expect(summary).toHaveTextContent('your AlgaPSA calendar');
    fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'colleague' } });
    expect(summary).toHaveTextContent("the selected users' AlgaPSA calendars");
    expect(summary).not.toHaveTextContent('your AlgaPSA calendar');
    fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'creator' } });
    expect(summary).toHaveTextContent('your AlgaPSA calendar');
    expect(mocks.permissions).toHaveBeenCalledOnce();
    expect(mocks.users).toHaveBeenCalledOnce();
  });
});
