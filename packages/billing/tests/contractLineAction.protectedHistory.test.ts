import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  currentLine: {} as any,
  periods: [] as any[],
  details: [] as any[],
  persisted: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => {
  const builder = (table: string): any => {
    const q: any = {
      where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), whereIn: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(), forUpdate: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(), first: vi.fn(async () => table === 'contract_lines' ? state.currentLine : undefined),
      update: vi.fn(async () => 1), insert: vi.fn(async () => undefined),
      then: (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(
        table === 'recurring_service_periods' ? state.periods :
          table === 'invoice_charge_details as iid' ? state.details : []
      ).then(resolve, reject),
    };
    return q;
  };
  const db: any = { table: (name: string) => builder(name), tenantJoin: vi.fn() };
  const knex: any = {};
  return {
    createTenantKnex: vi.fn(async () => ({ knex, tenant: 'tenant-1' })),
    tenantDb: vi.fn(() => db),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => unknown) => callback(knex)),
  };
});
vi.mock('../src/models/contractLine', () => ({ default: {
  findById: vi.fn(async () => state.currentLine),
  update: vi.fn(async (_trx: unknown, _id: string, data: any) => { state.persisted(data); return { ...state.currentLine, ...data }; }),
} }));
vi.mock('../src/models/contractLineFixedConfig', () => ({ default: {} }));
vi.mock('../src/services/contractLineServiceConfigurationService', () => ({ ContractLineServiceConfigurationService: class {} }));
vi.mock('../src/lib/authHelpers', () => ({ getAnalyticsAsync: async () => ({ analytics: { capture: vi.fn() }, AnalyticsEvents: { BILLING_RULE_UPDATED: 'updated' } }) }));
vi.mock('../src/lib/billing/contractLineWindow', async (load) => {
  const actual: any = await load();
  return { ...actual, validateContractLineWindow: vi.fn(async () => null) };
});
vi.mock('../src/actions/recurringServicePeriodSync', () => ({ syncRecurringServicePeriodsForContractLine: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));

import { updateContractLine } from '../src/actions/contractLineAction';

const invoke = updateContractLine as any;
const user = { user_id: 'user-1' };
const ctx = { tenant: 'tenant-1' };
const claimedPeriod = {
  lifecycle_state: 'locked', start: '2026-06-01', end: '2026-07-01',
};

describe('updateContractLine protected billed history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currentLine = {
      contract_line_id: 'line-1', contract_id: 'contract-1', contract_line_type: 'Fixed',
      start_date: '2026-05-01', end_date: null, billing_timing: 'arrears', cadence_owner: 'client',
    };
    state.periods = [{ ...claimedPeriod }];
    state.details = [];
  });

  it('accepts future end dates and exact half-open boundaries, including a released locked claim', async () => {
    await expect(invoke(user, ctx, 'line-1', { end_date: '2026-07-01' })).resolves.toMatchObject({ end_date: '2026-07-01' });
    state.persisted.mockClear();
    await expect(invoke(user, ctx, 'line-1', { end_date: '2027-01-01' })).resolves.toMatchObject({ end_date: '2027-01-01' });
    expect(state.persisted).toHaveBeenLastCalledWith(expect.objectContaining({ end_date: '2027-01-01' }));
  });

  it('rejects an end date cutting into a claimed service period without persisting', async () => {
    await expect(invoke(user, ctx, 'line-1', { end_date: '2026-06-15' })).resolves.toMatchObject({
      messageKey: 'msp/contracts:contractLines.errors.protectedEndDate',
      messageParams: { boundary: '2026-07-01' },
    });
    expect(state.persisted).not.toHaveBeenCalled();
  });

  it('merges partial updates, accepts invoice text, enforces start boundary, and rejects clearing a protected date', async () => {
    await expect(invoke(user, ctx, 'line-1', { invoice_line_description: 'Corrected text' }))
      .resolves.toMatchObject({ invoice_line_description: 'Corrected text', end_date: null });
    expect(state.persisted).toHaveBeenCalledWith(expect.objectContaining({ invoice_line_description: 'Corrected text' }));
    state.persisted.mockClear();
    await expect(invoke(user, ctx, 'line-1', { start_date: '2026-06-01' })).resolves.toMatchObject({ start_date: '2026-06-01' });
    state.persisted.mockClear();
    await expect(invoke(user, ctx, 'line-1', { start_date: '2026-06-02' })).resolves.toMatchObject({
      messageKey: 'msp/contracts:contractLines.errors.protectedStartDate',
      messageParams: { boundary: '2026-06-01' },
    });
    await expect(invoke(user, ctx, 'line-1', { start_date: null })).resolves.toMatchObject({
      messageKey: 'msp/contracts:contractLines.errors.protectedStartDate',
    });
    expect(state.persisted).not.toHaveBeenCalled();
  });

  it('includes invoice detail periods linked by service configuration, independent of invoice draft status', async () => {
    state.periods = [];
    state.currentLine.start_date = null;
    state.details = [{ start: '2026-04-01', end: '2026-05-01' }];
    await expect(invoke(user, ctx, 'line-1', { end_date: '2026-04-15' })).resolves.toMatchObject({
      messageKey: 'msp/contracts:contractLines.errors.protectedEndDate',
      messageParams: { boundary: '2026-05-01' },
    });
    expect(state.persisted).not.toHaveBeenCalled();
  });
});
