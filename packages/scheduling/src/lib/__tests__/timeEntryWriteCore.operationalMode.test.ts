/**
 * F067: a write in operational mode (the server resolved a seat principal) stores the operational field set
 * from `operationalTimeEntryFields()` and runs neither contract resolution nor billing allocation. The
 * commercial path (no mode, or `commercial`) is unchanged: it resolves the contract and reconciles allocations.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: any }>,
  updates: [] as Array<{ table: string; row: any }>,
  existing: undefined as any,
  resolveTimeEntryContract: vi.fn(async () => ({ contractLineId: 'line-1', source: 'auto_unique_service' })),
  reconcile: vi.fn(async () => ({ prepaidBlockUsage: undefined })),
}));

function builder(table: string) {
  const b: any = {
    where: () => b, orWhere: () => b, forUpdate: () => b, select: () => b,
    first: async () => (table === 'time_entries' ? h.existing : table === 'tickets' ? { assigned_to: null } : undefined),
    insert: (row: any) => { h.inserts.push({ table, row }); return { returning: async () => [row] }; },
    update: (row: any) => {
      h.updates.push({ table, row });
      const result: any = Promise.resolve(1);
      result.returning = async () => [{ ...row, entry_id: h.existing?.entry_id }];
      return result;
    },
  };
  return b;
}

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tenantDb: () => ({ table: (name: string) => builder(name), tenantJoin: () => undefined }),
  resolveUserTimeZone: async () => 'UTC',
  recordTicketAssigneeChange: vi.fn(),
  recalculateProjectTaskActualHoursForEntryChange: vi.fn(),
}));
vi.mock('@alga-psa/authorization/recordCreateAuthorization', () => ({ assertRecordCreateAllowed: vi.fn() }));
vi.mock('@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee', () => ({
  assertHumanWorkAssignee: vi.fn(), assertHumanWorkOwner: vi.fn(), timeEntryWorkItem: vi.fn(),
}));
vi.mock('@product/service-principals/entry', () => ({ stampTimeEntryAttribution: async () => ({}) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn() }));
vi.mock('../../actions/timeEntryHelpers', () => ({ getClientIdForWorkItem: vi.fn() }));
vi.mock('../../actions/timeEntryDelegationAuth', () => ({ assertCanActOnBehalf: vi.fn() }));
vi.mock('../../actions/timeEntryChangeRequestActions', () => ({ markTimeEntryChangeRequestsHandled: vi.fn() }));
vi.mock('../timeEntryContract', () => ({ resolveTimeEntryContract: h.resolveTimeEntryContract }));
vi.mock('../timeEntryBillingAllocations', () => ({ reconcileTimeEntryBillingAllocations: h.reconcile }));

import { persistTimeEntry } from '../timeEntryWriteCore';

const actor: any = { user_id: 'user-1' };
const base = {
  work_item_id: 'ticket-1', work_item_type: 'ticket', notes: 'n', approval_status: 'DRAFT',
  start_time: '2026-09-01T12:00:00Z', end_time: '2026-09-01T13:30:00Z', billable_duration: 90,
  created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
} as any;

const insertedEntry = () => h.inserts.find((i) => i.table === 'time_entries')!.row;

describe('persistTimeEntry operational mode', () => {
  beforeEach(() => {
    h.inserts.length = 0; h.updates.length = 0; h.existing = undefined;
    h.resolveTimeEntryContract.mockClear(); h.reconcile.mockClear();
  });

  it('writes the operational field set and skips contract resolution and allocation', async () => {
    const result = await persistTimeEntry({} as any, { tenant: 't', actor, mode: 'operational', entry: { ...base } });
    expect(insertedEntry()).toMatchObject({
      billing_mode: 'operational', billable_duration: 0, service_id: null, contract_line_id: null,
      contract_line_source: null, tax_rate_id: null, tax_region: null, invoiced: false,
    });
    // Actual effort stays in the instants.
    expect(new Date(insertedEntry().start_time).toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(new Date(insertedEntry().end_time).toISOString()).toBe('2026-09-01T13:30:00.000Z');
    expect(result.finalBillableDuration).toBe(0);
    expect(h.resolveTimeEntryContract).not.toHaveBeenCalled();
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    ['service_id', { service_id: 'service-1' }],
    ['contract_line_id', { contract_line_id: 'line-1' }],
    ['tax_rate_id', { tax_rate_id: 'rate-1' }],
    ['tax_region', { tax_region: 'US-NY' }],
  ])('rejects a commercial field (%s) with OPERATIONAL_TIME_COMMERCIAL_FIELDS and writes nothing', async (_n, extra) => {
    await expect(persistTimeEntry({} as any, { tenant: 't', actor, mode: 'operational', entry: { ...base, ...extra } }))
      .rejects.toMatchObject({ code: 'OPERATIONAL_TIME_COMMERCIAL_FIELDS' });
    expect(h.inserts.filter((i) => i.table === 'time_entries')).toHaveLength(0);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('refuses to turn an existing commercial entry operational', async () => {
    h.existing = { entry_id: 'e1', user_id: 'user-1', invoiced: false, billing_mode: 'commercial' };
    await expect(persistTimeEntry({} as any, { tenant: 't', actor, mode: 'operational', entry: { ...base, entry_id: 'e1' } }))
      .rejects.toThrow('A commercial time entry cannot be saved as operational.');
    expect(h.updates.filter((u) => u.table === 'time_entries')).toHaveLength(0);
  });

  it.each([['omitted', undefined], ['commercial', 'commercial' as const]])(
    'keeps the commercial path when mode is %s: resolves the contract and reconciles allocations',
    async (_n, mode) => {
      await persistTimeEntry({} as any, { tenant: 't', actor, ...(mode ? { mode } : {}), entry: { ...base, service_id: 'service-1' } });
      const row = insertedEntry();
      expect(row.service_id).toBe('service-1');
      expect(row.contract_line_id).toBe('line-1');
      expect(row.billable_duration).toBe(90);
      expect(row).not.toHaveProperty('billing_mode');
      expect(h.resolveTimeEntryContract).toHaveBeenCalledTimes(1);
      expect(h.reconcile).toHaveBeenCalledTimes(1);
    },
  );
});
