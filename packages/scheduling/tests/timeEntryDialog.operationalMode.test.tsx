// @vitest-environment jsdom
/**
 * Operational mode of the real TimeEntryDialog (seat technician, S27 / F066).
 *
 * The mode is what the server resolved and handed down through TimeEntryModeProvider. In operational mode the
 * commercial server actions (service catalog, tax regions, client tax/contract lookups, the time-source
 * service rule, the project payment warning) must never be INVOKED, and the save carries no commercial field.
 * Without a provider the dialog is commercial and reads exactly what it reads today.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => {
  const t = (key: string, options?: string | Record<string, any>) =>
    typeof options === 'string' ? options : (options?.defaultValue ?? key);
  return {
    t,
    fetchServicesForTimeEntry: vi.fn(async () => [{ id: 'service-1', name: 'Implementation', billing_method: 'hourly' }]),
    fetchTaxRegions: vi.fn(async () => []),
    isServiceOptionalForWorkItem: vi.fn(async () => false),
    resolveDefaultTicketTimeEntryService: vi.fn(async () => null),
    getClientIdForWorkItem: vi.fn(async () => 'client-1'),
    getSchedulingClientById: vi.fn(async () => null),
    getProjectTaskPaymentWarning: vi.fn(async () => null),
    toast: { loading: vi.fn(() => 'l'), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() },
  };
});

vi.mock('../src/actions/timeEntryActions', () => ({
  isServiceOptionalForWorkItem: (...a: unknown[]) => mocks.isServiceOptionalForWorkItem(...(a as [])),
  fetchServicesForTimeEntry: (...a: unknown[]) => mocks.fetchServicesForTimeEntry(...(a as [])),
  fetchTaxRegions: (...a: unknown[]) => mocks.fetchTaxRegions(...(a as [])),
  resolveDefaultTicketTimeEntryService: (...a: unknown[]) => mocks.resolveDefaultTicketTimeEntryService(...(a as [])),
  fetchClientTaxRateForWorkItem: vi.fn(async () => null),
  fetchScheduleEntryForWorkItem: vi.fn(async () => null),
  deleteTimeEntry: vi.fn(),
  fetchTimeEntriesForTimeSheet: vi.fn(async () => []),
}));
vi.mock('../src/lib/contractLineDisambiguation', () => ({
  getClientIdForWorkItem: (...a: unknown[]) => mocks.getClientIdForWorkItem(...(a as [])),
}));
vi.mock('../src/actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById: (...a: unknown[]) => mocks.getSchedulingClientById(...(a as [])),
}));
vi.mock('../src/context/SchedulingCrossFeatureContext', () => ({
  useSchedulingCrossFeatureOptional: () => ({ getProjectTaskPaymentWarning: mocks.getProjectTaskPaymentWarning }),
}));
vi.mock('react-hot-toast', () => ({ toast: mocks.toast, default: mocks.toast }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.t }),
  useFormatters: () => ({ locale: 'en', dateFormat: { dateOrder: 'mdy', timeFormat: '12h' }, formatDate: (v: Date | string) => String(v) }),
  translate: (_n: string, key: string, options?: any) => options?.defaultValue ?? key,
}));
vi.mock('../src/components/time-management/time-entry/time-sheet/SingleTimeEntryForm', () => ({
  default: (props: any) => (
    <input
      data-testid="dialog-note-input"
      value={props.entry.notes ?? ''}
      onChange={(e) => props.onUpdateEntry(0, { ...props.entry, notes: e.target.value, isDirty: true })}
    />
  ),
}));

import TimeEntryDialog from '../src/components/time-management/time-entry/time-sheet/TimeEntryDialog';
import { TimeEntryModeProvider } from '../src/context/TimeEntryModeContext';

const date = new Date('2026-09-01T12:00:00.000Z');
const defaultStartTime = new Date('2026-09-01T12:00:00.000Z');
const defaultEndTime = new Date('2026-09-01T13:00:00.000Z');
const timePeriod = { period_id: 'p1', start_date: '2026-09-01', end_date: '2026-09-08', tenant: 't' };
const workItem = { work_item_id: 'ticket-1', type: 'ticket' as const, name: 'Ticket 1', description: '', is_billable: true };
const taskWorkItem = { work_item_id: 'task-1', type: 'project_task' as const, name: 'Task', description: '', is_billable: true };

function renderDialog(mode: 'operational' | 'commercial' | null, item: any = workItem) {
  const onSave = vi.fn(async () => {});
  const onClose = vi.fn();
  const dialog = (
    <TimeEntryDialog
      isOpen
      onClose={onClose}
      onSave={onSave}
      workItem={item}
      date={date}
      timePeriod={timePeriod as any}
      isEditable
      defaultStartTime={defaultStartTime}
      defaultEndTime={defaultEndTime}
      timeSheetId="sheet-1"
      inDrawer
    />
  );
  render(mode ? <TimeEntryModeProvider mode={mode}>{dialog}</TimeEntryModeProvider> : dialog);
  return { onSave, onClose };
}

const commercialReaders = () => [
  mocks.fetchServicesForTimeEntry,
  mocks.fetchTaxRegions,
  mocks.isServiceOptionalForWorkItem,
  mocks.resolveDefaultTicketTimeEntryService,
  mocks.getClientIdForWorkItem,
  mocks.getSchedulingClientById,
  mocks.getProjectTaskPaymentWarning,
];

describe('TimeEntryDialog operational mode', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([['ticket', workItem], ['project_task', taskWorkItem]])(
    'invokes no service, tax, client or contract reader for a %s',
    async (_name, item) => {
      const { onSave } = renderDialog('operational', item);
      await screen.findByTestId('dialog-note-input');
      fireEvent.change(screen.getByTestId('dialog-note-input'), { target: { value: 'fixed the printer' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      for (const reader of commercialReaders()) expect(reader).not.toHaveBeenCalled();
    },
  );

  it('saves without a service and without any commercial field, and never asks for a service', async () => {
    const { onSave, onClose } = renderDialog('operational');
    await screen.findByTestId('dialog-note-input');
    fireEvent.change(screen.getByTestId('dialog-note-input'), { target: { value: 'note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const sent = (onSave.mock.calls[0] as any[])[0];
    expect(sent.service_id).toBeUndefined();
    expect(sent.tax_region).toBeUndefined();
    expect(sent.tax_rate_id).toBeUndefined();
    expect(sent.contract_line_id).toBeUndefined();
    expect(sent.contract_line_source).toBeUndefined();
    expect(sent.billable_duration).toBe(0);
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it.each([['no provider', null], ['a commercial provider', 'commercial' as const]])(
    'keeps the commercial reads with %s',
    async (_name, mode) => {
      renderDialog(mode);
      await screen.findByTestId('dialog-note-input');
      expect(mocks.fetchServicesForTimeEntry).toHaveBeenCalledWith('ticket');
      expect(mocks.fetchTaxRegions).toHaveBeenCalledTimes(1);
      expect(mocks.isServiceOptionalForWorkItem).toHaveBeenCalledTimes(1);
      expect(mocks.getClientIdForWorkItem).toHaveBeenCalledTimes(1);
    },
  );
});
