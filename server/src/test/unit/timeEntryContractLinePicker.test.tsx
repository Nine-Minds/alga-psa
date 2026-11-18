// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ plans: vi.fn() }));
vi.mock('@alga-psa/scheduling/lib/contractLineDisambiguation', () => ({
  getEligibleContractLinesForUI: mocks.plans, getClientIdForWorkItem: async () => 'client-1',
}));
vi.mock('@alga-psa/scheduling/actions/clientInteractionLookupActions', () => ({ getSchedulingClientById: async () => ({}) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue || '' }),
  useFormatters: () => ({ formatDate: (value: Date | string) => new Date(value).toISOString().slice(0, 10) }),
}));
vi.mock('@alga-psa/ui/components/BillingAttributionInspector', () => ({ BillingAttributionInspector: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: () => null }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => null }));
vi.mock('@alga-psa/ui/components/TimePicker', () => ({ TimePicker: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: () => null }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select data-testid={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryChangeRequestFeedback', () => ({ TimeEntryChangeRequestPanel: () => null }));
import TimeEntryEditForm from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryEditForm';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const entry: any = {
  entry_id: 'entry-1', client_id: 'client-1', service_id: 'service-1', work_item_id: 'ticket-1', work_item_type: 'ticket',
  start_time: '2026-08-10T08:00:00Z', end_time: '2026-08-10T09:00:00Z', billable_duration: 60, notes: '',
};
const line = (id: string, name: string, contract?: string) => ({
  client_contract_line_id: id, contract_line_name: name, contract_line_type: 'Hourly',
  contract_name: contract, start_date: '2026-01-01', has_bucket_overlay: false,
});
function props(value: any, update: any): any {
  return { id: 'entry', entry: value, index: 0, isEditable: true, services: [], timeInputs: {}, totalDuration: 60,
    onUpdateEntry: update, onUpdateTimeInputs: vi.fn(), onDelete: vi.fn() };
}

it('ambiguous service: shows warning + picker; a picked line is sent as explicit and stays selected on reload', async () => {
  mocks.plans.mockResolvedValue([line('line-1', 'Support', 'Gold'), line('line-2', 'Projects')]);
  const update = vi.fn();
  const view = render(<TimeEntryEditForm {...props(entry, update)} />);
  const select = await screen.findByTestId('contract-line-0') as HTMLSelectElement;
  expect(screen.getByText(/Multiple contract lines are eligible/)).toBeTruthy();
  expect(Array.from(select.options).map(o => o.text)).toEqual(['No line - resolve later', 'Gold — Support', 'Projects']);
  expect(update).not.toHaveBeenCalled(); // nothing auto-filled

  fireEvent.change(select, { target: { value: 'line-2' } });
  const payload = update.mock.calls.at(-1)![1];
  expect(payload).toMatchObject({ contract_line_id: 'line-2', contract_line_source: 'explicit' });

  // Round trip: the parent stores the payload and re-renders (or the entry reloads from the DB).
  view.rerender(<TimeEntryEditForm {...props(payload, update)} />);
  await waitFor(() => expect((screen.getByTestId('contract-line-0') as HTMLSelectElement).value).toBe('line-2'));
  expect(update).toHaveBeenCalledTimes(1); // still eligible: not cleared

  // Blank is allowed: sends no id and no 'explicit' provenance (server then records unresolved).
  fireEvent.change(screen.getByTestId('contract-line-0'), { target: { value: '' } });
  expect(update.mock.calls.at(-1)![1]).toMatchObject({ contract_line_id: null, contract_line_source: undefined });
});

it('unambiguous service: no picker and nothing sent (server resolves with an auto_* source)', async () => {
  mocks.plans.mockResolvedValue([line('line-1', 'Support')]);
  const update = vi.fn();
  render(<TimeEntryEditForm {...props(entry, update)} />);
  await waitFor(() => expect(mocks.plans).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByTestId('contract-line-0')).toBeNull();
  expect(update).not.toHaveBeenCalled();
});

it('opening a saved entry whose line ends on its work date does not clear or dirty it (incl. clientId resolving)', async () => {
  // end_date is a date-only string (UTC midnight when parsed) and the entry is mid-afternoon the same day.
  mocks.plans.mockResolvedValue([
    { ...line('line-1', 'Support', 'Gold'), end_date: '2026-08-10' },
    line('line-2', 'Projects'),
  ]);
  const update = vi.fn();
  const saved = { ...entry, start_time: '2026-08-10T15:00:00Z', end_time: '2026-08-10T16:00:00Z',
    contract_line_id: 'line-1', contract_line_source: 'explicit' };
  const view = render(<TimeEntryEditForm {...props(saved, update)} />);
  await waitFor(() => expect(mocks.plans).toHaveBeenCalled());
  await act(async () => {});
  view.rerender(<TimeEntryEditForm {...props({ ...saved }, update)} />);
  await act(async () => {});
  expect((screen.getByTestId('contract-line-0') as HTMLSelectElement).value).toBe('line-1');
  expect(update).not.toHaveBeenCalled();
});

it('changing the service to one that excludes the chosen line clears it', async () => {
  mocks.plans.mockImplementation(async (_c: string, service: string) =>
    service === 'service-1' ? [line('line-1', 'Support'), line('line-2', 'Projects')] : [line('line-9', 'Other'), line('line-8', 'Else')]);
  const update = vi.fn();
  const saved = { ...entry, contract_line_id: 'line-1', contract_line_source: 'explicit' };
  const view = render(<TimeEntryEditForm {...props(saved, update)} />);
  await screen.findByTestId('contract-line-0');
  await act(async () => {});
  expect(update).not.toHaveBeenCalled();
  view.rerender(<TimeEntryEditForm {...props({ ...saved, service_id: 'service-2' }, update)} />);
  await waitFor(() => expect(update).toHaveBeenCalled());
  expect(update.mock.calls.at(-1)![1]).toMatchObject({ service_id: 'service-2', contract_line_id: null, isDirty: true });
});
