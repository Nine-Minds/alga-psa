// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { actionError } from '@alga-psa/ui/lib/errorHandling';

const mocks = vi.hoisted(() => ({
  fetchOrCreateTimeSheet: vi.fn(),
  saveTimeEntry: vi.fn(),
  dialogProps: [] as any[],
}));

vi.mock('../src/actions/timeEntryActions', () => ({
  fetchOrCreateTimeSheet: (...args: unknown[]) => mocks.fetchOrCreateTimeSheet(...args),
  saveTimeEntry: (...args: unknown[]) => mocks.saveTimeEntry(...args),
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
    formatDate: (value: Date | string) => new Date(value).toISOString().slice(0, 10),
  }),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, disabled, placeholder }: any) => (
    <select
      id={id}
      data-testid={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {(options ?? []).map((option: any) => (
        <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/TimeEntryDialog', () => ({
  default: (props: any) => {
    mocks.dialogProps.push(props);
    return (
      <div data-testid="time-entry-dialog-stub">
        <span data-testid="dialog-sheet-id">{props.timeSheetId}</span>
        <button
          data-testid="dialog-save"
          onClick={() => {
            void Promise.resolve(props.onSave({ work_item_id: 'ticket-1' })).catch(() => undefined);
          }}
        />
      </div>
    );
  },
}));

import TimeEntryPeriodLauncher from '../src/components/time-management/time-entry/time-sheet/TimeEntryPeriodLauncher';

function period(
  period_id: string,
  start_date: string,
  end_date: string,
  timeSheetStatus: string,
  timeSheetId: string | null,
) {
  return {
    period_id,
    start_date,
    end_date,
    timeSheetStatus,
    timeSheetId,
    hoursEntered: 0,
    daysLogged: 0,
    tenant: 'tenant-1',
  } as any;
}

const periods = [
  period('period-current', '2026-09-01', '2026-09-08', 'DRAFT', 'sheet-current'),
  period('period-prior-draft', '2026-08-01', '2026-08-08', 'DRAFT', null),
  period('period-changes', '2026-07-01', '2026-07-08', 'CHANGES_REQUESTED', 'sheet-changes'),
  period('period-locked', '2026-06-01', '2026-06-08', 'SUBMITTED', 'sheet-submitted'),
];

function renderLauncher(overrides: Record<string, unknown> = {}) {
  return render(
    <TimeEntryPeriodLauncher
      closeDrawer={vi.fn()}
      onComplete={vi.fn()}
      workItem={{ work_item_id: 'ticket-1', type: 'ticket', name: 'Ticket 1', description: '' } as any}
      context={{ workItemId: 'ticket-1', workItemType: 'ticket', workItemName: 'Ticket 1' } as any}
      userId="user-1"
      userTimeZone="America/New_York"
      periods={periods}
      currentPeriodId="period-current"
      {...overrides}
    />,
  );
}

describe('TimeEntryPeriodLauncher', () => {
  beforeEach(() => {
    mocks.dialogProps.length = 0;
    mocks.fetchOrCreateTimeSheet.mockReset();
    mocks.saveTimeEntry.mockReset();
  });
  afterEach(() => cleanup());

  it('preselects the server-resolved current period and enables Continue', () => {
    renderLauncher();
    expect(screen.getByTestId('time-entry-period-select')).toHaveValue('period-current');
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
    expect(mocks.fetchOrCreateTimeSheet).not.toHaveBeenCalled();
  });

  it('shows locked periods with status and disables Continue without resolving a sheet', () => {
    renderLauncher();
    fireEvent.change(screen.getByTestId('time-entry-period-select'), {
      target: { value: 'period-locked' },
    });
    expect(screen.getByText(/now Submitted|is Submitted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    expect(mocks.fetchOrCreateTimeSheet).not.toHaveBeenCalled();
  });

  it('resolves only the selected period on Continue and mounts the dialog with that sheet and period', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({
      id: 'sheet-prior-draft',
      approval_status: 'DRAFT',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-prior-draft', start_date: '2026-08-01', end_date: '2026-08-08' },
    });
    renderLauncher();

    fireEvent.change(screen.getByTestId('time-entry-period-select'), {
      target: { value: 'period-prior-draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(screen.getByTestId('time-entry-dialog-stub')).toBeInTheDocument());
    expect(mocks.fetchOrCreateTimeSheet).toHaveBeenCalledTimes(1);
    expect(mocks.fetchOrCreateTimeSheet).toHaveBeenCalledWith('user-1', 'period-prior-draft');
    expect(mocks.dialogProps[0].timeSheetId).toBe('sheet-prior-draft');
    expect(mocks.dialogProps[0].timePeriod.start_date).toBe('2026-08-01');
    expect(mocks.dialogProps[0].isEditable).toBe(true);
  });

  it('renders CHANGES_REQUESTED periods as editable and selectable', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({
      id: 'sheet-changes',
      approval_status: 'CHANGES_REQUESTED',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-changes', start_date: '2026-07-01', end_date: '2026-07-08' },
    });
    renderLauncher();

    fireEvent.change(screen.getByTestId('time-entry-period-select'), {
      target: { value: 'period-changes' },
    });
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(screen.getByTestId('time-entry-dialog-stub')).toBeInTheDocument());
    expect(mocks.fetchOrCreateTimeSheet).toHaveBeenCalledWith('user-1', 'period-changes');
  });

  it('keeps the picker and explains when the sheet becomes locked during resolution', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({
      id: 'sheet-current',
      approval_status: 'APPROVED',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-current', start_date: '2026-09-01', end_date: '2026-09-08' },
    });
    renderLauncher();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(screen.getByText(/now Approved/i)).toBeInTheDocument());
    expect(screen.getByTestId('time-entry-period-select')).toBeInTheDocument();
    expect(screen.queryByTestId('time-entry-dialog-stub')).not.toBeInTheDocument();
  });

  it('shows returned resolution errors in the picker and can retry', async () => {
    mocks.fetchOrCreateTimeSheet
      .mockResolvedValueOnce(actionError('Unable to prepare the time sheet.', 'msp/time-entry:errors.timeSheet.resolve'))
      .mockResolvedValueOnce({
        id: 'sheet-current',
        approval_status: 'DRAFT',
        tenant: 'tenant-1',
        time_period: { period_id: 'period-current', start_date: '2026-09-01', end_date: '2026-09-08' },
      });
    renderLauncher();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByText('Unable to prepare the time sheet.')).toBeInTheDocument());
    expect(screen.queryByTestId('time-entry-dialog-stub')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByTestId('time-entry-dialog-stub')).toBeInTheDocument());
  });

  it('prevents a doubled Continue from resolving twice', async () => {
    let resolve!: (value: unknown) => void;
    mocks.fetchOrCreateTimeSheet.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderLauncher();

    const continueButton = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);

    expect(mocks.fetchOrCreateTimeSheet).toHaveBeenCalledTimes(1);
    resolve({
      id: 'sheet-current',
      approval_status: 'DRAFT',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-current', start_date: '2026-09-01', end_date: '2026-09-08' },
    });
    await waitFor(() => expect(screen.getByTestId('time-entry-dialog-stub')).toBeInTheDocument());
  });

  it('cancel closes the drawer', () => {
    const closeDrawer = vi.fn();
    renderLauncher({ closeDrawer });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(closeDrawer).toHaveBeenCalledTimes(1);
  });

  it('rejects save failures and never reports completion', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({
      id: 'sheet-current',
      approval_status: 'DRAFT',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-current', start_date: '2026-09-01', end_date: '2026-09-08' },
    });
    const onComplete = vi.fn();
    renderLauncher({ onComplete });

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(mocks.dialogProps.length).toBe(1));

    mocks.saveTimeEntry.mockResolvedValue(actionError('Locked sheet.', 'msp/time-entry:errors.timeSheet.notEditable'));
    await expect(mocks.dialogProps[0].onSave({ work_item_id: 'ticket-1' })).rejects.toThrow('Locked sheet.');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('completes exactly once on successful save', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({
      id: 'sheet-current',
      approval_status: 'DRAFT',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-current', start_date: '2026-09-01', end_date: '2026-09-08' },
    });
    const onComplete = vi.fn();
    renderLauncher({ onComplete });

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(mocks.dialogProps.length).toBe(1));

    mocks.saveTimeEntry.mockResolvedValue({ entry_id: 'entry-1' });
    await mocks.dialogProps[0].onSave({ work_item_id: 'ticket-1' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
