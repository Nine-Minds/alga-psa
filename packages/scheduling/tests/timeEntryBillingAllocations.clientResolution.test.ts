import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { ITimeEntry } from '@alga-psa/types';

const getClientIdForWorkItem = vi.fn();
const adjustTimeSpanDraw = vi.fn();
const allocateTimeEntryDetailed = vi.fn();
const reverseTimeEntryAllocations = vi.fn();

vi.mock('../src/actions/timeEntryHelpers', () => ({
  getClientIdForWorkItem: (...args: unknown[]) => getClientIdForWorkItem(...args),
}));
vi.mock('@alga-psa/shared/billingClients/drawAdjustments', () => ({
  adjustTimeSpanDraw: (...args: unknown[]) => adjustTimeSpanDraw(...args),
}));
vi.mock('@alga-psa/shared/billingClients/bucketUsageErrors', () => ({
  isBucketUsageError: () => false,
}));
vi.mock('@alga-psa/shared/billingClients/hourBlockService', () => ({
  allocateTimeEntryDetailed: (...args: unknown[]) => allocateTimeEntryDetailed(...args),
  reverseTimeEntryAllocations: (...args: unknown[]) => reverseTimeEntryAllocations(...args),
}));

import { reconcileTimeEntryBillingAllocations } from '../src/lib/timeEntryBillingAllocations';

const TENANT = 'tenant-1';
const burnTrx = { name: 'burn-savepoint' } as unknown as Knex.Transaction;
const trx = {
  transaction: async (fn: (t: Knex.Transaction) => Promise<unknown>) => fn(burnTrx),
} as unknown as Knex.Transaction;

function savedEntry(overrides: Partial<ITimeEntry> = {}): ITimeEntry {
  return {
    entry_id: 'entry-1',
    work_item_id: 'ticket-new',
    work_item_type: 'ticket',
    service_id: 'service-1',
    start_time: '2024-12-10T10:00:00Z',
    end_time: '2024-12-10T12:00:00Z',
    work_date: '2024-12-10',
    billable_duration: 120,
    contract_line_id: 'line-1',
    ...overrides,
  } as ITimeEntry;
}

describe('reconcileTimeEntryBillingAllocations: client of the saved entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adjustTimeSpanDraw.mockResolvedValue(0);
    allocateTimeEntryDetailed.mockResolvedValue({
      target: { kind: 'contract', contractLineId: 'line-1' },
      allocations: [{ minutes: 120 }],
    });
  });

  it('resolves the new entry client once and draws the bucket and burns the hour block against it', async () => {
    getClientIdForWorkItem.mockResolvedValue('client-new');

    const result = await reconcileTimeEntryBillingAllocations(trx, TENANT, {
      entry_id: undefined,
      resultingEntry: savedEntry(),
      oldEntrySpan: null,
      oldDuration: 0,
    });

    expect(getClientIdForWorkItem).toHaveBeenCalledTimes(1);
    expect(getClientIdForWorkItem).toHaveBeenCalledWith(trx, TENANT, 'ticket-new', 'ticket');
    expect(adjustTimeSpanDraw).toHaveBeenCalledWith(trx, TENANT, 'client-new', expect.objectContaining({ service_id: 'service-1' }), 1);
    expect(allocateTimeEntryDetailed).toHaveBeenCalledWith(burnTrx, TENANT, 'client-new', expect.objectContaining({ entry_id: 'entry-1' }));
    expect(result.prepaidBlockUsage).toEqual({ clientId: 'client-new', contractLineId: 'line-1' });
  });

  it('on a move between clients reverses under the old client and burns under the new one, resolving each once', async () => {
    getClientIdForWorkItem.mockImplementation(async (_trx, _tenant, workItemId: string) =>
      workItemId === 'ticket-old' ? 'client-old' : 'client-new',
    );

    await reconcileTimeEntryBillingAllocations(trx, TENANT, {
      entry_id: 'entry-1',
      resultingEntry: savedEntry(),
      oldEntrySpan: { work_item_id: 'ticket-old', work_item_type: 'ticket', service_id: 'service-1', start_time: '2024-12-09T10:00:00Z', end_time: '2024-12-09T11:00:00Z', contract_line_id: 'line-1' },
      oldDuration: 60,
    });

    expect(getClientIdForWorkItem.mock.calls.map((call) => call[2])).toEqual(['ticket-old', 'ticket-new']);
    expect(adjustTimeSpanDraw.mock.calls.map((call) => [call[2], call[4]])).toEqual([['client-old', -1], ['client-new', 1]]);
    expect(reverseTimeEntryAllocations).toHaveBeenCalledWith(burnTrx, TENANT, 'entry-1');
    expect(allocateTimeEntryDetailed).toHaveBeenCalledWith(burnTrx, TENANT, 'client-new', expect.anything());
  });

  it('draws and burns nothing when the saved entry has no client', async () => {
    getClientIdForWorkItem.mockResolvedValue(null);

    const result = await reconcileTimeEntryBillingAllocations(trx, TENANT, {
      entry_id: undefined,
      resultingEntry: savedEntry({ work_item_type: 'ad_hoc', work_item_id: 'schedule-1' }),
      oldEntrySpan: null,
      oldDuration: 0,
    });

    expect(getClientIdForWorkItem).toHaveBeenCalledTimes(1);
    expect(adjustTimeSpanDraw).not.toHaveBeenCalled();
    expect(allocateTimeEntryDetailed).not.toHaveBeenCalled();
    expect(result.prepaidBlockUsage).toBeUndefined();
  });
});
