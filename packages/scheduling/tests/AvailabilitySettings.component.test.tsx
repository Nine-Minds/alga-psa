/* @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const getAvailabilitySettings = vi.fn();
const getAvailabilitySettingsAccess = vi.fn();
const createOrUpdateAvailabilitySetting = vi.fn();
const saveUserAvailabilityWeek = vi.fn();
const deleteAvailabilitySetting = vi.fn();
const getAvailabilityExceptions = vi.fn();
const addAvailabilityException = vi.fn();
const deleteAvailabilityException = vi.fn();
const getServices = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@alga-psa/scheduling/actions', () => ({
  getAvailabilitySettings: (...args: unknown[]) => getAvailabilitySettings(...(args as [])),
  getAvailabilitySettingsAccess: (...args: unknown[]) => getAvailabilitySettingsAccess(...(args as [])),
  createOrUpdateAvailabilitySetting: (...args: unknown[]) => createOrUpdateAvailabilitySetting(...(args as [])),
  saveUserAvailabilityWeek: (...args: unknown[]) => saveUserAvailabilityWeek(...(args as [])),
  deleteAvailabilitySetting: (...args: unknown[]) => deleteAvailabilitySetting(...(args as [])),
  getAvailabilityExceptions: (...args: unknown[]) => getAvailabilityExceptions(...(args as [])),
  addAvailabilityException: (...args: unknown[]) => addAvailabilityException(...(args as [])),
  deleteAvailabilityException: (...args: unknown[]) => deleteAvailabilityException(...(args as [])),
  getServices: (...args: unknown[]) => getServices(...(args as [])),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...(args as [])),
    error: (...args: unknown[]) => toastError(...(args as [])),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));

vi.mock('lucide-react', () => ({
  Plus: () => null,
  Trash2: () => null,
  Save: () => null,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title }: any) => (isOpen ? <div><h1>{title}</h1>{children}</div> : null),
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Tabs', async () => {
  const { createContext, useContext } = await import('react');
  const Ctx = createContext<{ value: string; onValueChange: (value: string) => void }>({ value: '', onValueChange: () => {} });
  return {
    Tabs: ({ value, onValueChange, children }: any) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ value, children }: any) => {
      const ctx = useContext(Ctx);
      return <button data-testid={`tab-${value}`} onClick={() => ctx.onValueChange(value)}>{children}</button>;
    },
    TabsContent: ({ value, children }: any) => {
      const ctx = useContext(Ctx);
      return ctx.value === value ? <div>{children}</div> : null;
    },
  };
});

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, value, onChange, placeholder }: any) => (
    <input data-testid={id} id={id} value={value ?? ''} onChange={onChange} placeholder={placeholder} />
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ id, onClick, disabled, children }: any) => (
    <button data-testid={id} id={id} onClick={onClick} disabled={!!disabled}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ htmlFor, children }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange, disabled }: any) => (
    <input
      type="checkbox"
      role="switch"
      data-testid={id}
      id={id}
      checked={!!checked}
      disabled={!!disabled}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, disabled, options, placeholder }: any) => (
    <select
      data-testid={id}
      id={id}
      value={value ?? ''}
      disabled={!!disabled}
      onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value)}
    >
      <option value="">{placeholder ?? ''}</option>
      {(options ?? []).map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: ({ id, value, onChange, disabled }: any) => (
    <input
      data-testid={id}
      id={id}
      value={value ?? ''}
      disabled={!!disabled}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Calendar', () => ({
  Calendar: () => null,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Table', () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns }: any) => (
    <div data-testid={id}>
      {(data ?? []).map((row: any, rowIndex: number) => (
        <div key={rowIndex}>
          {columns.map((column: any, columnIndex: number) => (
            <span key={columnIndex}>{column.render ? column.render(row[column.dataIndex], row) : row[column.dataIndex]}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

import AvailabilitySettings from '../src/components/schedule/AvailabilitySettings';
import { AVAILABILITY_CONTEXT_STORAGE_KEY } from '../src/lib/availabilityContext';

const userA = {
  user_id: 'user-a', username: 'morgan', first_name: 'Morgan', last_name: 'Chen',
  email: 'morgan@example.com', is_inactive: false, tenant: 'tenant-1', user_type: 'internal', reports_to: null,
};
const userB = {
  user_id: 'user-b', username: 'bella', first_name: 'Bella', last_name: 'Ozma',
  email: 'bella@example.com', is_inactive: false, tenant: 'tenant-1', user_type: 'internal', reports_to: null,
};

const adminAccess = {
  canReadSystemSettings: true,
  canManageSystemSettings: true,
  canManageUserHours: true,
  users: [userA, userB],
  teams: [{ team_id: 'team-1', team_name: 'team', manager_id: null, member_ids: ['user-a'] }],
};

const weekRows = (userId: string, wednesdayEnd: string) =>
  Array.from({ length: 7 }, (_, day) => ({
    availability_setting_id: `${userId}-${day}`,
    tenant: 'tenant-1',
    setting_type: 'user_hours',
    user_id: userId,
    day_of_week: day,
    is_available: day >= 1 && day <= 5,
    start_time: '09:00:00',
    end_time: day === 3 ? wednesdayEnd : '17:00:00',
  }));

function bootstrap(options: { settings?: any[] } = {}) {
  getAvailabilitySettingsAccess.mockResolvedValue({ success: true, data: adminAccess });
  getServices.mockResolvedValue({ services: [] });
  getAvailabilityExceptions.mockResolvedValue({ success: true, data: [] });
  getAvailabilitySettings.mockImplementation(async (filters?: any) => {
    if (!filters) return { success: true, data: options.settings ?? [] };
    return { success: true, data: [] };
  });
}

async function openUserHoursTab() {
  render(<AvailabilitySettings isOpen onClose={() => {}} />);
  const tab = await screen.findByTestId('tab-user-hours');
  fireEvent.click(tab);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe('AvailabilitySettings rendered regressions', () => {
  it('loads a technician on the first selection with a stable loading state and normalized times', async () => {
    bootstrap();
    const load = deferred<any>();
    getAvailabilitySettings.mockImplementation(async (filters?: any) => {
      if (!filters) return { success: true, data: [] };
      return load.promise;
    });

    await openUserHoursTab();
    fireEvent.change(await screen.findByTestId('user-hours-selector'), { target: { value: 'user-a' } });

    expect(await screen.findByText('Loading technician hours...')).toBeInTheDocument();
    expect(screen.queryByTestId('day-3-end-time')).toBeNull();

    load.resolve({ success: true, data: weekRows('user-a', '17:00:00') });

    expect(await screen.findByTestId('day-3-end-time')).toHaveValue('17:00');
    expect(screen.getByText('Saved booking hours')).toBeInTheDocument();
    const userHoursLoads = getAvailabilitySettings.mock.calls.filter(([filters]) => filters?.setting_type === 'user_hours');
    expect(userHoursLoads).toEqual([[{ setting_type: 'user_hours', user_id: 'user-a' }]]);
  });

  it('keeps the edited hours and shows only the error toast when the save fails', async () => {
    bootstrap();
    saveUserAvailabilityWeek.mockResolvedValue({ success: false, error: 'Failed to save user hours' });

    await openUserHoursTab();
    fireEvent.change(await screen.findByTestId('user-hours-selector'), { target: { value: 'user-a' } });
    const wednesdayEnd = await screen.findByTestId('day-3-end-time');
    fireEvent.change(wednesdayEnd, { target: { value: '16:30' } });
    fireEvent.click(screen.getByTestId('save-user-hours'));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to save user hours');
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('day-3-end-time')).toHaveValue('16:30');
    expect(screen.getByText('Unsaved Monday–Friday 9:00 AM–5:00 PM template')).toBeInTheDocument();
  });

  it('treats an incomplete save response as failure and retains the edits', async () => {
    bootstrap();
    saveUserAvailabilityWeek.mockResolvedValue({ success: true, data: weekRows('user-a', '16:30:00').slice(0, 6) });

    await openUserHoursTab();
    fireEvent.change(await screen.findByTestId('user-hours-selector'), { target: { value: 'user-a' } });
    fireEvent.change(await screen.findByTestId('day-3-end-time'), { target: { value: '16:30' } });
    fireEvent.click(screen.getByTestId('save-user-hours'));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to save user hours');
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('day-3-end-time')).toHaveValue('16:30');
  });

  it('disables selectors while saving and toasts the exact success message only after the confirmed week', async () => {
    bootstrap();
    const save = deferred<any>();
    saveUserAvailabilityWeek.mockReturnValue(save.promise);

    await openUserHoursTab();
    fireEvent.change(await screen.findByTestId('user-hours-selector'), { target: { value: 'user-a' } });
    fireEvent.change(await screen.findByTestId('day-3-end-time'), { target: { value: '16:30' } });
    fireEvent.click(screen.getByTestId('save-user-hours'));

    expect(await screen.findByText('Saving...')).toBeInTheDocument();
    expect(screen.getByTestId('save-user-hours')).toBeDisabled();
    expect(screen.getByTestId('user-hours-selector')).toBeDisabled();
    expect(screen.getByTestId('team-selector')).toBeDisabled();
    expect(toastSuccess).not.toHaveBeenCalled();

    save.resolve({ success: true, data: weekRows('user-a', '16:30:00') });

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledTimes(1);
    });
    expect(toastSuccess).toHaveBeenCalledWith('User hours saved');
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId('day-3-end-time')).toHaveValue('16:30');
    expect(screen.getByText('Saved booking hours')).toBeInTheDocument();
    expect(screen.getByTestId('user-hours-selector')).not.toBeDisabled();
  });

  it('never lets a pending save response overwrite a newly selected technician', async () => {
    bootstrap({ settings: weekRows('user-b', '15:00:00') });
    const loads: Record<string, ReturnType<typeof deferred<any>>> = {
      'user-a': deferred<any>(),
      'user-b': deferred<any>(),
    };
    getAvailabilitySettings.mockImplementation(async (filters?: any) => {
      if (!filters) return { success: true, data: weekRows('user-b', '15:00:00') };
      return loads[filters.user_id].promise;
    });
    const save = deferred<any>();
    saveUserAvailabilityWeek.mockReturnValue(save.promise);

    await openUserHoursTab();
    fireEvent.change(await screen.findByTestId('user-hours-selector'), { target: { value: 'user-a' } });
    loads['user-a'].resolve({ success: true, data: [] });
    fireEvent.change(await screen.findByTestId('day-3-end-time'), { target: { value: '16:30' } });
    fireEvent.click(screen.getByTestId('save-user-hours'));

    // Switch to the second technician through the configured-users table while
    // the first save is still pending, and let that load settle first.
    fireEvent.click(await screen.findByTestId('edit-user-user-b'));
    expect(await screen.findByText('Loading technician hours...')).toBeInTheDocument();
    loads['user-b'].resolve({ success: true, data: weekRows('user-b', '15:00:00') });
    expect(await screen.findByTestId('day-3-end-time')).toHaveValue('15:00');

    save.resolve({ success: true, data: weekRows('user-a', '16:30:00') });

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('User hours saved');
    });
    // The save response for user A must not populate user B's editor.
    expect(screen.getByTestId('day-3-end-time')).toHaveValue('15:00');
    expect(screen.getByText('Technician:').parentElement).toHaveTextContent('Bella Ozma');
  });

  it('restores a valid persisted team and technician scope after refresh', async () => {
    window.sessionStorage.setItem(AVAILABILITY_CONTEXT_STORAGE_KEY, JSON.stringify({
      isOpen: true, activeTab: 'user-hours', selectedTeamId: 'team-1', selectedUserId: 'user-a',
    }));
    bootstrap();
    getAvailabilitySettings.mockImplementation(async (filters?: any) => {
      if (!filters) return { success: true, data: [] };
      return { success: true, data: weekRows('user-a', '16:30:00') };
    });

    render(<AvailabilitySettings isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('day-3-end-time')).toHaveValue('16:30');
    });
    expect(screen.getByTestId('team-selector')).toHaveValue('team-1');
    expect(screen.getByTestId('user-hours-selector')).toHaveValue('user-a');
    expect(screen.getByText('Technician:').parentElement).toHaveTextContent('Morgan Chen');
    expect(screen.getByText('Team filter:').parentElement).toHaveTextContent('team');
  });

  it('clears persisted team and technician ids that are no longer authorized options', async () => {
    window.sessionStorage.setItem(AVAILABILITY_CONTEXT_STORAGE_KEY, JSON.stringify({
      isOpen: true, activeTab: 'user-hours', selectedTeamId: 'ghost-team', selectedUserId: 'ghost-user',
    }));
    bootstrap();

    render(<AvailabilitySettings isOpen onClose={() => {}} />);

    await waitFor(() => {
      const persisted = JSON.parse(window.sessionStorage.getItem(AVAILABILITY_CONTEXT_STORAGE_KEY)!);
      expect(persisted.selectedTeamId).toBe('');
      expect(persisted.selectedUserId).toBe('');
    });
    expect(screen.getByTestId('team-selector')).toHaveValue('');
    expect(screen.getByTestId('user-hours-selector')).toHaveValue('');
    expect(screen.queryByTestId('day-3-end-time')).toBeNull();
  });
});
