// @vitest-environment jsdom
/**
 * The real TimeEntryEditForm in operational mode: the service, contract-line and billable controls are not
 * rendered and the form's own client / tax / contract-line loaders never run. Commercial mode keeps them.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  getEligibleContractLinesForUI: vi.fn(async () => []),
  getClientIdForWorkItem: vi.fn(async () => 'client-1'),
  getSchedulingClientById: vi.fn(async () => null),
}));

vi.mock('../src/lib/contractLineDisambiguation', () => ({
  getEligibleContractLinesForUI: (...a: unknown[]) => mocks.getEligibleContractLinesForUI(...(a as [])),
  getClientIdForWorkItem: (...a: unknown[]) => mocks.getClientIdForWorkItem(...(a as [])),
}));
vi.mock('../src/actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById: (...a: unknown[]) => mocks.getSchedulingClientById(...(a as [])),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string, o?: any) => (typeof o === 'string' ? o : o?.defaultValue ?? k) }),
  useFormatters: () => ({ locale: 'en', dateFormat: { dateOrder: 'mdy', timeFormat: '12h' }, formatDate: (v: any) => String(v) }),
  translate: (_n: string, k: string, o?: any) => o?.defaultValue ?? k,
}));

import TimeEntryEditForm from '../src/components/time-management/time-entry/time-sheet/TimeEntryEditForm';
import { TimeEntryModeProvider } from '../src/context/TimeEntryModeContext';

const entry: any = {
  work_item_id: 'ticket-1', work_item_type: 'ticket', entry_id: '', user_id: '', isNew: true, tempId: 't1',
  start_time: '2026-09-01T12:00:00Z', end_time: '2026-09-01T13:00:00Z', billable_duration: 60, notes: '',
  service_id: 'service-1', approval_status: 'DRAFT', created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
};

function renderForm(mode: 'operational' | 'commercial') {
  render(
    <TimeEntryModeProvider mode={mode}>
      <TimeEntryEditForm
        id="f" entry={entry} index={0} isEditable
        services={[{ id: 'service-1', name: 'Implementation', type: 'Time', tax_rate_id: null, tax_percentage: null }]}
        taxRegions={[]} timeInputs={{}} totalDuration={60}
        onDelete={async () => {}} onUpdateEntry={() => {}} onUpdateTimeInputs={() => {}}
      />
    </TimeEntryModeProvider>,
  );
}

describe('TimeEntryEditForm operational mode', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('renders no service, contract-line or billable control and runs no loader', async () => {
    renderForm('operational');
    expect(screen.queryByText('Service')).not.toBeInTheDocument();
    expect(document.getElementById('f-service-0')).toBeNull();
    expect(document.getElementById('f-billable-duration-0')).toBeNull();
    expect(screen.queryByText('Billable')).not.toBeInTheDocument();
    expect(screen.queryByText('Contract line')).not.toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    await Promise.resolve();
    expect(mocks.getClientIdForWorkItem).not.toHaveBeenCalled();
    expect(mocks.getSchedulingClientById).not.toHaveBeenCalled();
    expect(mocks.getEligibleContractLinesForUI).not.toHaveBeenCalled();
  });

  it('commercial mode still renders the service and billable controls and loads', async () => {
    renderForm('commercial');
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Billable')).toBeInTheDocument();
    await vi.waitFor(() => expect(mocks.getClientIdForWorkItem).toHaveBeenCalled());
  });
});
