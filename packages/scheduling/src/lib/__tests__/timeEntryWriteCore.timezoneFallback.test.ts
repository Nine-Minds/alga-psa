/**
 * Round trip (mocked-knex unit test; no database is reachable in this environment):
 * persistTimeEntry runs the REAL resolveUserTimeZone/computeWorkDateFields against a stubbed
 * users/tenant_settings, so the stored work_date/work_timezone come from the same resolver the drawer uses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: any }>,
  userTz: null as unknown,
  tenantTz: undefined as unknown,
}));

function builder(table: string) {
  const b: any = {
    where: () => b, orWhere: () => b, forUpdate: () => b, select: () => b,
    first: async () => {
      if (table === 'users') return { timezone: h.userTz };
      if (table === 'tenant_settings') return { settings: h.tenantTz === undefined ? {} : { timezone: h.tenantTz } };
      if (table === 'tickets') return { assigned_to: null };
      return undefined;
    },
    insert: (row: any) => { h.inserts.push({ table, row }); return { returning: async () => [row] }; },
    update: () => {
      const result: any = Promise.resolve(1);
      result.returning = async () => [{}];
      return result;
    },
  };
  return b;
}

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordTicketAssigneeChange: vi.fn(),
  recalculateProjectTaskActualHoursForEntryChange: vi.fn(),
}));
vi.mock('@alga-psa/authorization/recordCreateAuthorization', () => ({ assertRecordCreateAllowed: vi.fn(), assertWorkItemParentAllowed: vi.fn() }));
vi.mock('@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee', () => ({
  assertHumanWorkAssignee: vi.fn(), assertHumanWorkOwner: vi.fn(), timeEntryWorkItem: vi.fn(),
}));
vi.mock('@product/service-principals/entry', () => ({ stampTimeEntryAttribution: async () => ({}) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn() }));
vi.mock('../../actions/timeEntryHelpers', () => ({ getClientIdForWorkItem: vi.fn() }));
vi.mock('../../actions/timeEntryDelegationAuth', () => ({ assertCanActOnBehalf: vi.fn() }));
vi.mock('../../actions/timeEntryChangeRequestActions', () => ({ markTimeEntryChangeRequestsHandled: vi.fn() }));
vi.mock('../timeEntryContract', () => ({ resolveTimeEntryContract: vi.fn(async () => ({ contractLineId: 'line-1', source: 'auto_unique_service' })) }));
vi.mock('../timeEntryBillingAllocations', () => ({ reconcileTimeEntryBillingAllocations: vi.fn(async () => ({ prepaidBlockUsage: undefined })) }));

import { persistTimeEntry } from '../timeEntryWriteCore';
import { formatZonedTime } from '../timeEntryPeriodSelection';

// Real tenantDb over a callable fake knex, so the real resolver and write core both run.
const fakeKnex: any = (table: string) => builder(table);
const actor: any = { user_id: 'user-1' };
const entry = () => ({
  work_item_id: 'ticket-1', work_item_type: 'ticket', notes: 'n', approval_status: 'DRAFT',
  start_time: '2026-10-19T22:00:00Z', end_time: '2026-10-19T23:00:00Z', billable_duration: 60,
  created_at: '2026-10-19T23:00:00Z', updated_at: '2026-10-19T23:00:00Z',
}) as any;
const inserted = () => h.inserts.find((i) => i.table === 'time_entries')!.row;

describe('persistTimeEntry work_date/work_timezone follow the effective zone', () => {
  beforeEach(() => {
    h.inserts.length = 0; h.userTz = null; h.tenantTz = undefined;
  });

  it('Brisbane tenant, no profile zone: stores Brisbane and the picker reads 08:00', async () => {
    h.tenantTz = 'Australia/Brisbane';
    await persistTimeEntry(fakeKnex, { tenant: 't', actor, entry: entry() });
    const row = inserted();
    expect(new Date(row.start_time).toISOString()).toBe('2026-10-19T22:00:00.000Z'); // no double shift
    expect(row.work_timezone).toBe('Australia/Brisbane');
    expect(row.work_date).toBe('2026-10-20');
    expect(formatZonedTime(row.start_time, row.work_timezone)).toBe('08:00');
  });

  it('user profile zone beats the tenant default', async () => {
    h.tenantTz = 'Australia/Brisbane';
    h.userTz = 'America/New_York';
    await persistTimeEntry(fakeKnex, { tenant: 't', actor, entry: entry() });
    expect(inserted().work_timezone).toBe('America/New_York');
    expect(inserted().work_date).toBe('2026-10-19'); // 18:00 EDT on the 19th
  });

  it('no zones anywhere: UTC', async () => {
    await persistTimeEntry(fakeKnex, { tenant: 't', actor, entry: entry() });
    expect(inserted().work_timezone).toBe('UTC');
    expect(inserted().work_date).toBe('2026-10-19');
  });
});
