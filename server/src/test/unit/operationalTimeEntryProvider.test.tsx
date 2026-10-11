/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { TimeEntryProvider, useTimeEntry } from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryProvider';

const mocks = vi.hoisted(() => ({ mode: vi.fn(), services: vi.fn(), tax: vi.fn(), clientId: vi.fn(), client: vi.fn() }));
vi.mock('@alga-psa/scheduling/actions/timeEntryCrudActions', () => ({ getTimeEntryBillingMode: mocks.mode }));
vi.mock('@alga-psa/scheduling/actions/timeEntryActions', () => ({ fetchServicesForTimeEntry: mocks.services, fetchTaxRegions: mocks.tax, fetchClientTaxRateForWorkItem: vi.fn(), fetchScheduleEntryForWorkItem: vi.fn() }));
vi.mock('@alga-psa/scheduling/lib/contractLineDisambiguation', () => ({ getClientIdForWorkItem: mocks.clientId }));
vi.mock('@alga-psa/scheduling/actions/clientInteractionLookupActions', () => ({ getSchedulingClientById: mocks.client }));
let context: ReturnType<typeof useTimeEntry>;
function Probe() { context = useTimeEntry(); return null; }
const params = { workItem: { work_item_id: 'task', type: 'project_task', name: 'Task', service_id: 'old-default', is_billable: true }, date: new Date('2026-09-07T09:00:00Z'), defaultStartTime: new Date('2026-09-07T09:00:00Z'), defaultEndTime: new Date('2026-09-07T10:30:00Z') } as any;
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('operational time entry initialization', () => {
  it('loads service-free defaults and keeps actual duration without billing lookups', async () => {
    mocks.mode.mockResolvedValue('operational'); render(<TimeEntryProvider><Probe /></TimeEntryProvider>);
    await act(() => context.initializeEntries(params));
    expect(context.entries).toMatchObject([{ billing_mode: 'operational', billable_duration: 0, service_id: undefined, contract_line_id: null, tax_rate_id: null }]);
    expect(context.totalDurations).toEqual([90]);
    for (const query of [mocks.services, mocks.tax, mocks.clientId, mocks.client]) expect(query).not.toHaveBeenCalled();
  });
  it('keeps saved operational effort unpriced after a paid PSA upgrade', async () => {
    mocks.mode.mockResolvedValue('commercial'); render(<TimeEntryProvider><Probe /></TimeEntryProvider>);
    await act(() => context.initializeEntries({ ...params, existingEntries: [{ entry_id: 'entry', billing_mode: 'operational', start_time: '2026-09-07T09:00:00Z', end_time: '2026-09-07T10:30:00Z', created_at: '2026-09-07T09:00:00Z', updated_at: '2026-09-07T09:00:00Z', service_id: null }] }));
    expect(context.entries[0]).toMatchObject({ billing_mode: 'operational', billable_duration: 0, service_id: undefined });
    expect(mocks.services).not.toHaveBeenCalled();
  });
  it('does not leave an earlier editable entry when the current mode cannot be verified', async () => {
    mocks.mode.mockResolvedValueOnce('operational').mockRejectedValueOnce(new Error('Mode unavailable'));
    render(<TimeEntryProvider><Probe /></TimeEntryProvider>); await act(() => context.initializeEntries(params));
    expect(context.entries).toHaveLength(1);
    await act(() => context.initializeEntries(params));
    expect(context.entries).toEqual([]); expect(context.error).toBeTruthy();
  });
  it('ignores a slower initialization for a previously selected work item', async () => {
    let release!: (mode: string) => void;
    mocks.mode.mockReturnValueOnce(new Promise(resolve => { release = resolve; })).mockResolvedValueOnce('operational');
    render(<TimeEntryProvider><Probe /></TimeEntryProvider>);
    let first!: Promise<void>;
    act(() => { first = context.initializeEntries(params); });
    await act(() => context.initializeEntries({ ...params, workItem: { ...params.workItem, work_item_id: 'new-task' } }));
    await act(async () => { release('operational'); await first; });
    await waitFor(() => expect(context.entries[0].work_item_id).toBe('new-task'));
  });
});

it('initializes shared commercial work with the admitted MSP client and retains entry identity for history', async () => {
  mocks.mode.mockResolvedValue('commercial'); mocks.clientId.mockResolvedValue('msp-client'); mocks.client.mockResolvedValue({ region_code: 'US-NY' });
  mocks.services.mockResolvedValue([{ id: 'msp-labor', name: 'MSP labor' }]); mocks.tax.mockResolvedValue([]);
  render(<TimeEntryProvider><Probe /></TimeEntryProvider>);
  const shared = { ...params, workItem: { work_item_id: 'local-reference', type: 'co_managed', name: 'Shared issue' } };
  await act(() => context.initializeEntries(shared));
  expect(mocks.clientId).toHaveBeenCalledWith('local-reference', 'co_managed', undefined);
  expect(mocks.client).toHaveBeenCalledWith('msp-client');
  expect(context.entries[0]).toMatchObject({ work_item_id: 'local-reference', work_item_type: 'co_managed', client_id: 'msp-client', billable_duration: 90 });
  await act(() => context.initializeEntries({ ...shared, existingEntries: [{ ...context.entries[0], entry_id: 'retained-entry' } as any] }));
  expect(mocks.clientId).toHaveBeenLastCalledWith('local-reference', 'co_managed', 'retained-entry');
});
