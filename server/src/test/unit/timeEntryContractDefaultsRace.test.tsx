// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ plans: vi.fn() }));
vi.mock('@alga-psa/scheduling/lib/contractLineDisambiguation', () => ({
  getEligibleContractLinesForUI: mocks.plans, getClientIdForWorkItem: async () => 'client-1',
}));
vi.mock('@alga-psa/scheduling/actions/clientInteractionLookupActions', () => ({ getSchedulingClientById: async () => ({}) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue || '' }) }));
vi.mock('@alga-psa/ui/components/BillingAttributionInspector', () => ({ BillingAttributionInspector: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: () => null }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => null }));
vi.mock('@alga-psa/ui/components/TimePicker', () => ({ TimePicker: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: () => null }));
vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/ContractInfoBanner', () => ({ default: () => null }));
vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryChangeRequestFeedback', () => ({ TimeEntryChangeRequestPanel: () => null }));
import TimeEntryEditForm from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryEditForm';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const entry = {
  entry_id: 'entry-1', client_id: 'client-1', service_id: 'service-1', work_item_id: 'ticket-1', work_item_type: 'ticket',
  start_time: '2026-08-10T08:00:00Z', end_time: '2026-08-10T09:00:00Z', billable_duration: 60, notes: '',
};
const plan = { client_contract_line_id: 'line-1', start_date: '2026-01-01', has_bucket_overlay: false };
function props(value: any, update: any): any {
  return { id: 'entry', entry: value, index: 0, isEditable: true, services: [], timeInputs: {}, totalDuration: 60,
    onUpdateEntry: update, onUpdateTimeInputs: vi.fn(), onDelete: vi.fn() };
}
it('late contract defaults preserve duration and notes edited during lookup', async () => {
  let resolve!: (value: any) => void;
  mocks.plans.mockReturnValue(new Promise(done => { resolve = done; }));
  const update = vi.fn();
  const view = render(<TimeEntryEditForm {...props(entry, update)} />);
  await waitFor(() => expect(mocks.plans).toHaveBeenCalled());
  const edited = { ...entry, end_time: '2026-08-10T10:00:00Z', billable_duration: 120, notes: 'Two hours worked' };
  view.rerender(<TimeEntryEditForm {...props(edited, update)} />);
  await act(async () => resolve([plan]));
  expect(update).toHaveBeenLastCalledWith(0, { ...edited, contract_line_id: 'line-1' });
});
it('ignores a lookup for a service the user has replaced', async () => {
  let resolveOld!: (value: any) => void;
  let resolveNew!: (value: any) => void;
  mocks.plans.mockImplementation((_client: string, service: string) => new Promise(done => {
    if (service === 'service-1') resolveOld = done;
    else resolveNew = done;
  }));
  const update = vi.fn();
  const view = render(<TimeEntryEditForm {...props(entry, update)} />);
  await waitFor(() => expect(resolveOld).toBeDefined());
  const changed = { ...entry, service_id: 'service-2' };
  view.rerender(<TimeEntryEditForm {...props(changed, update)} />);
  await waitFor(() => expect(resolveNew).toBeDefined());
  await act(async () => resolveOld([plan]));
  expect(update).not.toHaveBeenCalled();
  await act(async () => resolveNew([{ ...plan, client_contract_line_id: 'line-2' }]));
  expect(update).toHaveBeenLastCalledWith(0, { ...changed, contract_line_id: 'line-2' });
});
it('does not replace a contract line selected while defaults were loading', async () => {
  let resolve!: (value: any) => void;
  mocks.plans.mockReturnValue(new Promise(done => { resolve = done; }));
  const update = vi.fn();
  const view = render(<TimeEntryEditForm {...props(entry, update)} />);
  await waitFor(() => expect(mocks.plans).toHaveBeenCalled());
  view.rerender(<TimeEntryEditForm {...props({ ...entry, contract_line_id: 'chosen-line' }, update)} />);
  await act(async () => resolve([plan]));
  expect(update).not.toHaveBeenCalled();
});
it('does not update the entry after the editor unmounts', async () => {
  let resolve!: (value: any) => void;
  mocks.plans.mockReturnValue(new Promise(done => { resolve = done; }));
  const update = vi.fn();
  const view = render(<TimeEntryEditForm {...props(entry, update)} />);
  await waitFor(() => expect(mocks.plans).toHaveBeenCalled());
  view.unmount();
  await act(async () => resolve([plan]));
  expect(update).not.toHaveBeenCalled();
});
