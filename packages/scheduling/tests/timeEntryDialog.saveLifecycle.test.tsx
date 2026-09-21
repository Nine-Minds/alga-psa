// @vitest-environment jsdom
/**
 * Rendered save lifecycle for the real TimeEntryDialog.
 *
 * The launcher stubs elsewhere only assert that onSave rejects/resolves; this
 * suite mounts the shipped dialog (with the heavy entry form replaced by a
 * controlled stub) so a failed persistence attempt is proven to keep the typed
 * values on screen and show an error without a success toast or close, and a
 * successful one to close exactly once. It also pins the work-item context
 * handed to save and the timezone-sensitive start time the provider derives.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => {
  const t = (key: string, options?: string | Record<string, any>) => {
    if (typeof options === 'string') return options;
    const template = options?.defaultValue ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) =>
      String(options?.[name] ?? ''),
    );
  };
  return {
    t,
    fetchServicesForTimeEntry: vi.fn(),
    fetchTaxRegions: vi.fn(),
    deleteTimeEntry: vi.fn(),
    fetchTimeEntriesForTimeSheet: vi.fn(),
    getClientIdForWorkItem: vi.fn(),
    toast: {
      loading: vi.fn(() => 'loading-toast'),
      dismiss: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../src/actions/timeEntryActions', () => ({
  fetchServicesForTimeEntry: (...args: unknown[]) => mocks.fetchServicesForTimeEntry(...args),
  fetchTaxRegions: (...args: unknown[]) => mocks.fetchTaxRegions(...args),
  fetchClientTaxRateForWorkItem: vi.fn(async () => null),
  fetchScheduleEntryForWorkItem: vi.fn(async () => null),
  deleteTimeEntry: (...args: unknown[]) => mocks.deleteTimeEntry(...args),
  fetchTimeEntriesForTimeSheet: (...args: unknown[]) => mocks.fetchTimeEntriesForTimeSheet(...args),
}));

vi.mock('../src/lib/contractLineDisambiguation', () => ({
  getClientIdForWorkItem: (...args: unknown[]) => mocks.getClientIdForWorkItem(...args),
}));

vi.mock('../src/actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById: vi.fn(async () => null),
}));

vi.mock('../src/context/SchedulingCrossFeatureContext', () => ({
  useSchedulingCrossFeatureOptional: () => undefined,
}));

vi.mock('react-hot-toast', () => ({ toast: mocks.toast, default: mocks.toast }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.t }),
  useFormatters: () => ({
    locale: 'en',
    dateFormat: { dateOrder: 'mdy', timeFormat: '12h' },
    formatDate: (value: Date | string) => new Date(value).toISOString().slice(0, 10),
  }),
  translate: (_namespace: string, _key: string, options?: any) => options?.defaultValue ?? _key,
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/SingleTimeEntryForm', () => ({
  default: (props: any) => (
    <div data-testid="entry-form-stub">
      <select
        data-testid="dialog-service-select"
        value={props.entry.service_id ?? ''}
        onChange={(event) =>
          props.onUpdateEntry(0, { ...props.entry, service_id: event.target.value, isDirty: true })
        }
      >
        <option value="">none</option>
        {(props.services ?? []).map((service: any) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>
      <input
        data-testid="dialog-note-input"
        value={props.entry.notes ?? ''}
        onChange={(event) => props.onUpdateEntry(0, { ...props.entry, notes: event.target.value, isDirty: true })}
      />
    </div>
  ),
}));

import TimeEntryDialog from '../src/components/time-management/time-entry/time-sheet/TimeEntryDialog';

const timePeriod = {
  period_id: 'period-1',
  start_date: '2026-09-01',
  end_date: '2026-09-08',
  tenant: 'tenant-1',
};

// Stable references: the dialog re-initializes entries from its effect deps, so
// inline Dates/objects would reset the form on every render.
const date = new Date('2026-09-01T12:00:00.000Z');
const defaultStartTime = new Date('2026-09-01T12:00:00.000Z');
const defaultEndTime = new Date('2026-09-01T13:00:00.000Z');

const projectTask = {
  work_item_id: 'task-1',
  type: 'project_task' as const,
  name: 'Build feature',
  description: '',
  service_id: 'service-1',
  service_name: 'Implementation',
  is_billable: true,
};

const ticket = {
  work_item_id: 'ticket-1',
  type: 'ticket' as const,
  name: 'Ticket 1',
  description: '',
  is_billable: true,
};

function renderDialog(overrides: Record<string, unknown> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <TimeEntryDialog
      isOpen={true}
      onClose={onClose}
      onSave={onSave}
      workItem={projectTask as any}
      date={date}
      timePeriod={timePeriod as any}
      isEditable={true}
      defaultStartTime={defaultStartTime}
      defaultEndTime={defaultEndTime}
      timeSheetId="sheet-1"
      inDrawer={true}
      {...overrides}
    />,
  );
  return { onSave, onClose };
}

async function waitForForm() {
  await screen.findByTestId('entry-form-stub');
}

describe('TimeEntryDialog save lifecycle (real dialog)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('a returned save error keeps the typed values, shows an error, and never closes or toasts success', async () => {
    mocks.fetchServicesForTimeEntry.mockResolvedValue([
      { id: 'service-1', name: 'Implementation', billing_method: 'hourly' },
    ]);
    mocks.fetchTaxRegions.mockResolvedValue([]);
    mocks.getClientIdForWorkItem.mockResolvedValue(null);

    const onSave = vi.fn().mockRejectedValue({ actionError: 'This time sheet is locked.' });
    renderDialog({ onSave });
    await waitForForm();

    fireEvent.change(screen.getByTestId('dialog-note-input'), { target: { value: 'my detailed note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave.mock.calls[0][0].work_item_id).toBe('task-1');
    expect(onSave.mock.calls[0][0].work_item_type).toBe('project_task');
    expect(screen.getByTestId('dialog-note-input')).toHaveValue('my detailed note');
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a successful save closes once, shows success, and passes the provided timezone-sensitive start time', async () => {
    mocks.fetchServicesForTimeEntry.mockResolvedValue([
      { id: 'service-1', name: 'Implementation', billing_method: 'hourly' },
    ]);
    mocks.fetchTaxRegions.mockResolvedValue([]);
    mocks.getClientIdForWorkItem.mockResolvedValue(null);

    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderDialog({ onSave, onClose });
    await waitForForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
    // 08:00 in the subject timezone was supplied as 12:00Z.
    expect(new Date(onSave.mock.calls[0][0].start_time).toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(mocks.toast.success).toHaveBeenCalled();
  });

  it('a ticket entry retains ticket context and reaches save after a service is chosen', async () => {
    mocks.fetchServicesForTimeEntry.mockResolvedValue([
      { id: 'service-1', name: 'Implementation', billing_method: 'hourly' },
    ]);
    mocks.fetchTaxRegions.mockResolvedValue([]);
    mocks.getClientIdForWorkItem.mockResolvedValue(null);

    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onSave, workItem: ticket });
    await waitForForm();

    fireEvent.change(screen.getByTestId('dialog-service-select'), { target: { value: 'service-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].work_item_id).toBe('ticket-1');
    expect(onSave.mock.calls[0][0].work_item_type).toBe('ticket');
  });
});
