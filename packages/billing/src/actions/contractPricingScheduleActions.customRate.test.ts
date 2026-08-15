import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(),
}));

const tableMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: { fn: { now: () => 'now()' } } })),
  tenantDb: vi.fn(() => ({ table: tableMock })),
}));

import { hasPermission } from '@alga-psa/auth/rbac';
import {
  createPricingSchedule,
  updatePricingSchedule,
} from './contractPricingScheduleActions';

const callCreatePricingSchedule = createPricingSchedule as any;
const callUpdatePricingSchedule = updatePricingSchedule as any;

const CUSTOM_RATE_ERROR = {
  actionError: "Custom rate must be a non-negative integer amount in the currency's minor units",
};

const user = { user_id: 'user-1' };
const ctx = { tenant: 'tenant-1' };

const existingSchedule = {
  tenant: 'tenant-1',
  schedule_id: 'schedule-1',
  contract_id: 'contract-1',
  effective_date: '2026-01-01T00:00:00.000Z',
  custom_rate: 12345,
};

/**
 * The overlap builders pass callbacks to where/orWhere; a returnThis mock never
 * invokes them, so the chain collapses to the queued first() results.
 */
function makeSchedulesQuery(firstResults: unknown[], row: Record<string, unknown>) {
  const queued = [...firstResults];
  const returning = vi.fn(async () => [row]);
  const query: any = {
    where: vi.fn().mockReturnThis(),
    whereNot: vi.fn().mockReturnThis(),
    whereNull: vi.fn().mockReturnThis(),
    orWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    first: vi.fn(async () => queued.shift()),
    insert: vi.fn(() => ({ returning })),
    update: vi.fn(() => ({ returning })),
  };
  return query;
}

function seedTables(schedulesFirstResults: unknown[], row: Record<string, unknown> = existingSchedule) {
  const schedulesQuery = makeSchedulesQuery(schedulesFirstResults, row);
  const contractsQuery = {
    where: vi.fn().mockReturnThis(),
    first: vi.fn(async () => ({ is_system_managed_default: false })),
  };
  tableMock.mockImplementation((tableName: string) => (
    tableName === 'contracts' ? contractsQuery : schedulesQuery
  ));
  return { schedulesQuery, contractsQuery };
}

function createData(customRate: unknown) {
  return {
    contract_id: 'contract-1',
    effective_date: '2026-01-01T00:00:00.000Z',
    end_date: null,
    custom_rate: customRate,
  };
}

describe('pricing schedule actions: custom_rate validation and null reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
  });

  it.each([
    ['a negative amount', -100],
    ['a fractional amount', 123.45],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a string amount', '100'],
  ])('create rejects %s before touching the table', async (_label, customRate) => {
    const { schedulesQuery } = seedTables([undefined]);

    await expect(callCreatePricingSchedule(user, ctx, createData(customRate)))
      .resolves.toEqual(CUSTOM_RATE_ERROR);
    expect(schedulesQuery.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['null (use the default rate)', null],
    ['zero minor units', 0],
    ['an integer minor-unit amount', 12345],
  ])('create accepts %s', async (_label, customRate) => {
    // First result: the overlap probe finds nothing.
    const { schedulesQuery } = seedTables([undefined]);

    await expect(callCreatePricingSchedule(user, ctx, createData(customRate)))
      .resolves.toEqual(existingSchedule);
    expect(schedulesQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ custom_rate: customRate })
    );
  });

  it.each([
    ['a negative amount', -1],
    ['a fractional amount', 0.5],
    ['NaN', Number.NaN],
    ['a string amount', 'abc'],
  ])('update rejects %s before touching the row', async (_label, customRate) => {
    // First result: the existing schedule lookup.
    const { schedulesQuery } = seedTables([existingSchedule]);

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { custom_rate: customRate }))
      .resolves.toEqual(CUSTOM_RATE_ERROR);
    expect(schedulesQuery.update).not.toHaveBeenCalled();
  });

  it('update persists an explicit custom_rate null so the reset actually clears the stored rate', async () => {
    // Existing schedule lookup, then the overlap probe finds nothing.
    const { schedulesQuery } = seedTables([existingSchedule, undefined]);

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { custom_rate: null }))
      .resolves.toEqual(existingSchedule);
    expect(schedulesQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ custom_rate: null })
    );
  });

  it('update accepts an integer minor-unit amount', async () => {
    const { schedulesQuery } = seedTables([existingSchedule, undefined]);

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { custom_rate: 5000 }))
      .resolves.toEqual(existingSchedule);
    expect(schedulesQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ custom_rate: 5000 })
    );
  });
});
