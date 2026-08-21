import { describe, expect, it, vi } from 'vitest';

const { tenantDbMock } = vi.hoisted(() => ({ tenantDbMock: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: tenantDbMock }));

import { applyContractLineAttributionDecisions } from '../src/lib/billing/contractLineAttributionWriter';

function builder(firstRow: Record<string, unknown> | null = null) {
  const query: any = {};
  query.where = vi.fn(() => query);
  query.whereNull = vi.fn(() => query);
  query.first = vi.fn(async () => firstRow);
  query.update = vi.fn(async () => 1);
  return query;
}

describe('contract-line attribution writer', () => {
  it('writes the time-entry and usage shapes independently', async () => {
    const timeQuery = builder();
    const usageQuery = builder();
    const trx: any = {
      fn: { now: vi.fn(() => 'NOW') },
      table: vi.fn((table: string) => table === 'time_entries' ? timeQuery : usageQuery),
    };
    tenantDbMock.mockReturnValue({ table: trx.table });

    const result = await applyContractLineAttributionDecisions(trx, 'tenant-1', [
      {
        kind: 'time_entry',
        recordId: 'entry-1',
        action: 'assign',
        contractLineId: 'line-1',
        source: 'reconciled_at_generation',
      },
      {
        kind: 'usage_record',
        recordId: 'usage-1',
        action: 'assign',
        contractLineId: 'line-1',
        source: 'reconciled_at_generation',
      },
    ]);

    expect(result).toEqual({ assigned: 2, markedUnresolved: 0 });
    expect(timeQuery.update).toHaveBeenCalledWith({
      contract_line_id: 'line-1',
      contract_line_source: 'reconciled_at_generation',
      contract_line_unresolved_reason: null,
      updated_at: 'NOW',
    });
    expect(usageQuery.update).toHaveBeenCalledWith({
      contract_line_id: 'line-1',
      contract_line_source: 'reconciled_at_generation',
      contract_line_unresolved_reason: null,
    });
  });

  it('is idempotent for an already-recorded unresolved decision', async () => {
    const usageQuery = builder({
      contract_line_id: null,
      contract_line_source: 'unresolved',
      contract_line_unresolved_reason: 'ambiguous',
    });
    const trx: any = {
      fn: { now: vi.fn(() => 'NOW') },
      table: vi.fn(() => usageQuery),
    };
    tenantDbMock.mockReturnValue({ table: trx.table });

    const result = await applyContractLineAttributionDecisions(trx, 'tenant-1', [{
      kind: 'usage_record',
      recordId: 'usage-1',
      action: 'mark_unresolved',
      reason: 'ambiguous',
    }]);

    expect(result).toEqual({ assigned: 0, markedUnresolved: 0 });
    expect(usageQuery.update).not.toHaveBeenCalled();
  });
});
