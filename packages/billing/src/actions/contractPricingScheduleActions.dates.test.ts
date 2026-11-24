import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(),
}));

const tableMock = vi.fn();

const fakeKnex: any = {
  fn: { now: () => 'now()' },
  transaction: (cb: (trx: any) => Promise<unknown>) => cb(fakeKnex),
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: fakeKnex })),
  tenantDb: vi.fn(() => ({ table: tableMock })),
}));

vi.mock('../lib/billing/billingMutationLock', () => ({
  lockTenantBilling: vi.fn(async () => undefined),
}));

import { hasPermission } from '@alga-psa/auth/rbac';
import {
  createPricingSchedule,
  getPricingSchedulesByContract,
  getPricingScheduleLineScopes,
  updatePricingSchedule,
} from './contractPricingScheduleActions';

const callCreatePricingSchedule = createPricingSchedule as any;
const callUpdatePricingSchedule = updatePricingSchedule as any;
const callGetPricingSchedulesByContract = getPricingSchedulesByContract as any;

const INVALID_DATE_ERROR = {
  actionError: 'Effective date and end date must be calendar dates (YYYY-MM-DD)',
  messageKey: 'msp/contracts:errors.pricingSchedule.invalidDate',
};

const user = { user_id: 'user-1' };
const ctx = { tenant: 'tenant-1' };

const storedRow = {
  tenant: 'tenant-1',
  schedule_id: 'schedule-1',
  contract_id: 'contract-1',
  contract_line_id: null,
  // A legacy row written through toISOString() before calendar dates landed.
  effective_date: '2026-01-01T00:00:00.000Z',
  end_date: null,
  custom_rate: 12345,
};

type Fixtures = {
  /** Queued `first()` results for contract_pricing_schedules (existing lookup, then overlap probe). */
  schedulesFirst?: unknown[];
  /** Rows the list read (`select('*')`) resolves to. */
  schedulesRows?: unknown[];
  /** Fixed lines of the contract, as contract_lines rows. */
  lines?: Array<{ contract_line_id: string; contract_line_name: string | null }>;
  /** Member rows: one per (line, pricing_basis). */
  members?: Array<{ contract_line_id: string; pricing_basis: string | null; configuration_type?: string; item_kind?: string }>;
};

/**
 * New schedules need a fixed-fee line to apply to, so every create below sees a
 * contract that owns one unless the test says otherwise.
 */
const DEFAULT_LINES = [{ contract_line_id: 'line-1', contract_line_name: 'Managed Services' }];

/**
 * The overlap builders pass callbacks to where/orWhere; a returnThis mock never
 * invokes them, so the chain collapses to the queued first() results. The scope
 * queries end on `select()`, which resolves to their rows.
 */
function seedTables(fixtures: Fixtures = {}) {
  const queued = [...(fixtures.schedulesFirst ?? [])];
  const returning = vi.fn(async () => [storedRow]);
  const schedulesQuery: any = {
    where: vi.fn().mockReturnThis(),
    whereNot: vi.fn().mockReturnThis(),
    whereNull: vi.fn().mockReturnThis(),
    orWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    first: vi.fn(async () => queued.shift()),
    select: vi.fn(async () => fixtures.schedulesRows ?? []),
    insert: vi.fn(() => ({ returning })),
    update: vi.fn(() => ({ returning })),
  };
  const contractsQuery = {
    where: vi.fn().mockReturnThis(),
    first: vi.fn(async () => ({ is_system_managed_default: false })),
  };
  const linesQuery: any = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    select: vi.fn(async () => fixtures.lines ?? DEFAULT_LINES),
  };
  const membersQuery: any = {
    join: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    select: vi.fn(async () => (fixtures.members ?? [{ contract_line_id: 'line-1', pricing_basis: 'bundle' }]).map(member => ({ configuration_type: 'Fixed', item_kind: 'service', ...member }))),
  };

  tableMock.mockImplementation((tableName: string) => {
    if (tableName === 'contracts') return contractsQuery;
    if (tableName === 'contract_lines') return linesQuery;
    if (tableName === 'contract_line_service_configuration as clsc') return membersQuery;
    return schedulesQuery;
  });

  return { schedulesQuery, contractsQuery, linesQuery, membersQuery };
}

function createData(overrides: Record<string, unknown> = {}) {
  return {
    contract_id: 'contract-1',
    contract_line_id: 'line-1',
    effective_date: '2026-06-01',
    end_date: null,
    custom_rate: 90000,
    ...overrides,
  };
}

describe('pricing schedule actions: calendar dates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
  });

  it('stores a picked calendar date byte-for-byte', async () => {
    const { schedulesQuery } = seedTables({ schedulesFirst: [undefined] });

    await expect(callCreatePricingSchedule(user, ctx, createData())).resolves.toEqual(storedRow);
    expect(schedulesQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ effective_date: '2026-06-01', end_date: null })
    );
  });

  it('normalises a timestamp effective_date to date-only in the insert payload', async () => {
    const { schedulesQuery } = seedTables({ schedulesFirst: [undefined] });

    await callCreatePricingSchedule(user, ctx, createData({
      // What the dialog used to send for 1 June picked in Berlin.
      effective_date: '2026-05-31T22:00:00.000Z',
      end_date: '2026-12-30T23:00:00.000Z',
    }));

    expect(schedulesQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ effective_date: '2026-05-31', end_date: '2026-12-30' })
    );
  });

  it.each([
    ['an unparseable string', 'not-a-date'],
    ['a malformed calendar date', '2026-13-45'],
    ['an empty string', ''],
  ])('create rejects %s without touching the table', async (_label, effectiveDate) => {
    const { schedulesQuery } = seedTables({ schedulesFirst: [undefined] });

    await expect(callCreatePricingSchedule(user, ctx, createData({ effective_date: effectiveDate })))
      .resolves.toEqual(INVALID_DATE_ERROR);
    expect(schedulesQuery.insert).not.toHaveBeenCalled();
  });

  it('update rejects an unparseable end date without touching the row', async () => {
    const { schedulesQuery } = seedTables({ schedulesFirst: [storedRow] });

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { end_date: 'whenever' }))
      .resolves.toEqual(INVALID_DATE_ERROR);
    expect(schedulesQuery.update).not.toHaveBeenCalled();
  });

  it('update normalises the stored legacy instant to a calendar date', async () => {
    const { schedulesQuery } = seedTables({ schedulesFirst: [storedRow, undefined] });

    await callUpdatePricingSchedule(user, ctx, 'schedule-1', { custom_rate: 5000 });

    expect(schedulesQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_date: '2026-01-01', custom_rate: 5000 })
    );
  });

  it.each([
    ['days', 10, '2026-06-11'],
    ['weeks', 2, '2026-06-15'],
    ['months', 6, '2026-12-01'],
    ['years', 1, '2027-06-01'],
  ])('derives the end date from a %s duration on the calendar', async (unit, value, expected) => {
    const { schedulesQuery } = seedTables({ schedulesFirst: [undefined] });

    await callCreatePricingSchedule(user, ctx, createData({
      duration_value: value,
      duration_unit: unit,
    }));

    expect(schedulesQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ effective_date: '2026-06-01', end_date: expected })
    );
  });

  it('clamps a month-end start instead of rolling into the next month', async () => {
    const { schedulesQuery } = seedTables({ schedulesFirst: [undefined] });

    await callCreatePricingSchedule(user, ctx, createData({
      effective_date: '2026-01-31',
      duration_value: 1,
      duration_unit: 'months',
    }));

    // Date.setMonth arithmetic used to land on 2026-03-03.
    expect(schedulesQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ end_date: '2026-02-28' })
    );
  });
});

describe('pricing schedule actions: line scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
  });

  it('probes the overlap in the line scope and inserts contract_line_id', async () => {
    const { schedulesQuery } = seedTables({
      schedulesFirst: [undefined],
      lines: [
        { contract_line_id: 'line-1', contract_line_name: 'Managed Services' },
        { contract_line_id: 'line-2', contract_line_name: 'Backup' },
      ],
      members: [{ contract_line_id: 'line-1', pricing_basis: 'bundle' }],
    });

    await expect(callCreatePricingSchedule(user, ctx, createData({ contract_line_id: 'line-1' })))
      .resolves.toEqual(storedRow);

    expect(schedulesQuery.where).toHaveBeenCalledWith('contract_line_id', 'line-1');
    expect(schedulesQuery.whereNull).not.toHaveBeenCalled();
    expect(schedulesQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-1' })
    );
  });

  it.each([null, undefined, ''])('rejects a new schedule without a line (%s)', async (scope) => {
    const { schedulesQuery } = seedTables();

    await expect(callCreatePricingSchedule(user, ctx, createData({ contract_line_id: scope })))
      .resolves.toEqual({
        actionError: 'Choose a fixed-fee line for this schedule',
        messageKey: 'msp/contracts:errors.pricingSchedule.lineRequired',
      });
    expect(schedulesQuery.insert).not.toHaveBeenCalled();
  });

  it('refuses new schedules on a contract without fixed-fee lines', async () => {
    const { schedulesQuery } = seedTables({ lines: [] });

    await expect(callCreatePricingSchedule(user, ctx, createData()))
      .resolves.toMatchObject({ messageKey: 'msp/contracts:errors.pricingSchedule.lineNotEligible' });
    expect(schedulesQuery.insert).not.toHaveBeenCalled();
  });

  it.each([null, ''])('refuses to change a line-scoped schedule to scope %s', async (scope) => {
    const { schedulesQuery } = seedTables({
      schedulesFirst: [{ ...storedRow, contract_line_id: 'line-1' }],
    });

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { contract_line_id: scope }))
      .resolves.toMatchObject({ messageKey: 'msp/contracts:errors.pricingSchedule.lineRequired' });
    expect(schedulesQuery.update).not.toHaveBeenCalled();
  });

  it('still checks overlap when editing a legacy whole-contract schedule', async () => {
    const { schedulesQuery } = seedTables({
      schedulesFirst: [storedRow, { ...storedRow, schedule_id: 'other-schedule' }],
    });

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { effective_date: '2026-07-01' }))
      .resolves.toMatchObject({ messageKey: 'msp/contracts:errors.pricingSchedule.wouldOverlap' });
    expect(schedulesQuery.whereNull).toHaveBeenCalledWith('contract_line_id');
    expect(schedulesQuery.update).not.toHaveBeenCalled();
  });

  it('refuses a schedule overlapping another on the same line', async () => {
    const overlapping = { ...storedRow, schedule_id: 'schedule-existing', contract_line_id: 'line-1' };
    const { schedulesQuery } = seedTables({
      schedulesFirst: [overlapping],
      members: [{ contract_line_id: 'line-1', pricing_basis: 'bundle' }],
    });

    await expect(callCreatePricingSchedule(user, ctx, createData({ contract_line_id: 'line-1' })))
      .resolves.toEqual({
        actionError: 'This schedule overlaps with an existing pricing schedule',
        messageKey: 'msp/contracts:errors.pricingSchedule.overlaps',
      });
    expect(schedulesQuery.insert).not.toHaveBeenCalled();
  });

  it('lets a line-scoped schedule coexist with a whole-contract one', async () => {
    // The probe is scoped to the line, so the whole-contract row it overlaps is
    // out of its query: the engine prefers the line-scoped rate on that line.
    const { schedulesQuery } = seedTables({
      schedulesFirst: [undefined],
      lines: [{ contract_line_id: 'line-1', contract_line_name: 'Managed Services' }],
      members: [{ contract_line_id: 'line-1', pricing_basis: 'bundle' }],
    });

    await expect(callCreatePricingSchedule(user, ctx, createData({ contract_line_id: 'line-1' })))
      .resolves.toEqual(storedRow);
    expect(schedulesQuery.where).toHaveBeenCalledWith('contract_line_id', 'line-1');
    expect(schedulesQuery.whereNull).not.toHaveBeenCalled();
    expect(schedulesQuery.insert).toHaveBeenCalled();
  });

  it('refuses a contract_line_id that is not a fixed line of this contract', async () => {
    const { schedulesQuery } = seedTables({
      schedulesFirst: [undefined],
      lines: [{ contract_line_id: 'line-1', contract_line_name: 'Managed Services' }],
      members: [],
    });

    await expect(callCreatePricingSchedule(user, ctx, createData({ contract_line_id: 'other-line' })))
      .resolves.toEqual({
        actionError: 'Pricing schedules apply to a fixed-fee line of this contract; pick one of its fixed lines',
        messageKey: 'msp/contracts:errors.pricingSchedule.lineNotEligible',
      });
    expect(schedulesQuery.insert).not.toHaveBeenCalled();
  });

  it('refuses a line whose members all bill per unit', async () => {
    const { schedulesQuery } = seedTables({
      schedulesFirst: [undefined],
      lines: [{ contract_line_id: 'line-1', contract_line_name: 'Recurring seats' }],
      members: [{ contract_line_id: 'line-1', pricing_basis: 'unit' }],
    });

    await expect(callCreatePricingSchedule(user, ctx, createData({ contract_line_id: 'line-1' })))
      .resolves.toEqual({
        actionError: 'This line bills per unit, so a pricing schedule would not change what it bills. Change the unit price on the line instead.',
        messageKey: 'msp/contracts:errors.pricingSchedule.lineUnitPriced',
      });
    expect(schedulesQuery.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['product bundle', [{ contract_line_id: 'line-1', pricing_basis: 'bundle', item_kind: 'product' }]],
    ['legacy product', [{ contract_line_id: 'line-1', pricing_basis: null, item_kind: 'product' }]],
    ['non-Fixed configuration', [{ contract_line_id: 'line-1', pricing_basis: null, configuration_type: 'Usage' }]],
    ['empty line', []],
  ])('excludes and rejects a %s without a billable bundle member', async (_name, members) => {
    const { schedulesQuery } = seedTables({ members, schedulesFirst: [storedRow] });
    const scopes = await (getPricingScheduleLineScopes as any)(user, ctx, 'contract-1');
    expect(scopes).toEqual([expect.objectContaining({ has_bundle_fee: false, has_unit_priced_members: false })]);
    await expect(callCreatePricingSchedule(user, ctx, createData())).resolves.toMatchObject({
      messageKey: 'msp/contracts:errors.pricingSchedule.lineNotEligible',
    });
    expect(schedulesQuery.insert).not.toHaveBeenCalled();
    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { contract_line_id: 'line-1' }))
      .resolves.toMatchObject({ messageKey: 'msp/contracts:errors.pricingSchedule.lineNotEligible' });
    expect(schedulesQuery.update).not.toHaveBeenCalled();
  });

  it('does not turn a unit-only service line into a bundle line because it also contains a product', async () => {
    seedTables({ members: [
      { contract_line_id: 'line-1', pricing_basis: 'unit' },
      { contract_line_id: 'line-1', pricing_basis: null, item_kind: 'product' },
    ] });
    expect(await (getPricingScheduleLineScopes as any)(user, ctx, 'contract-1')).toEqual([
      expect.objectContaining({ has_bundle_fee: false, has_unit_priced_members: true }),
    ]);
  });

  it('accepts a mixed line that still has a bundle member', async () => {
    const { schedulesQuery } = seedTables({
      schedulesFirst: [undefined],
      lines: [{ contract_line_id: 'line-1', contract_line_name: 'Managed Services' }],
      members: [
        { contract_line_id: 'line-1', pricing_basis: 'unit' },
        { contract_line_id: 'line-1', pricing_basis: null },
      ],
    });

    await expect(callCreatePricingSchedule(user, ctx, createData({ contract_line_id: 'line-1' })))
      .resolves.toEqual(storedRow);
    expect(schedulesQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-1' })
    );
  });

  it('keeps an existing contract-wide row contract-wide without re-validating a scope', async () => {
    const { schedulesQuery } = seedTables({ schedulesFirst: [storedRow, undefined] });

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { contract_line_id: null }))
      .resolves.toEqual(storedRow);

    expect(tableMock).not.toHaveBeenCalledWith('contract_lines');
    expect(schedulesQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: null })
    );
  });

  it('keeps a stored line scope when a save does not mention it', async () => {
    const lineScoped = { ...storedRow, contract_line_id: 'line-1' };
    const { schedulesQuery } = seedTables({ schedulesFirst: [lineScoped, undefined] });

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { effective_date: '2026-07-01' }))
      .resolves.toEqual(storedRow);

    // No contract_line_id in the payload: the stored scope is kept and not
    // re-validated, and the probe stays on that line.
    expect(tableMock).not.toHaveBeenCalledWith('contract_lines');
    expect(schedulesQuery.where).toHaveBeenCalledWith('contract_line_id', 'line-1');
  });

  it('validates the new scope when an existing row is re-scoped to a line', async () => {
    const { schedulesQuery } = seedTables({
      schedulesFirst: [storedRow, undefined],
      lines: [{ contract_line_id: 'line-2', contract_line_name: 'Backup' }],
      members: [{ contract_line_id: 'line-2', pricing_basis: 'bundle' }],
    });

    await expect(callUpdatePricingSchedule(user, ctx, 'schedule-1', { contract_line_id: 'line-2' }))
      .resolves.toEqual(storedRow);

    expect(tableMock).toHaveBeenCalledWith('contract_lines');
    expect(schedulesQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-2' })
    );
  });
});

describe('pricing schedule actions: read boundary', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
  });

  afterEach(() => {
    // TZ is process-global and vitest isolation is module-level only; assigning
    // an undefined original would set the literal string "undefined".
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it.each([
    { zone: 'Europe/Berlin', offset: -120 },
    { zone: 'Pacific/Auckland', offset: -720 },
    { zone: 'America/Los_Angeles', offset: 420 },
  ])('hands the client the stored calendar day under TZ=$zone', async ({ zone, offset }) => {
    process.env.TZ = zone;
    expect(
      new Date('2026-06-01T12:00:00.000Z').getTimezoneOffset(),
      `TZ=${zone} did not take effect`,
    ).toBe(offset);

    // pg ships no DATE (1082) parser, so a DATE column arrives as a Date at
    // server-local midnight. Reading its UTC components would be a day early
    // east of UTC — the same off-by-one on the way out as on the way in.
    seedTables({
      schedulesRows: [
        {
          ...storedRow,
          effective_date: new Date(2026, 5, 1),
          end_date: new Date(2026, 11, 31),
        },
      ],
    });

    await expect(callGetPricingSchedulesByContract(user, ctx, 'contract-1')).resolves.toEqual([
      expect.objectContaining({ effective_date: '2026-06-01', end_date: '2026-12-31' }),
    ]);
  });

  it('passes a stored calendar-date string through and keeps a null end date', async () => {
    seedTables({
      schedulesRows: [{ ...storedRow, effective_date: '2026-06-01', end_date: null }],
    });

    await expect(callGetPricingSchedulesByContract(user, ctx, 'contract-1')).resolves.toEqual([
      expect.objectContaining({ effective_date: '2026-06-01', end_date: null }),
    ]);
  });

  it('maps a legacy instant row to its UTC calendar date, as the write path does', async () => {
    seedTables({ schedulesRows: [storedRow] });

    await expect(callGetPricingSchedulesByContract(user, ctx, 'contract-1')).resolves.toEqual([
      expect.objectContaining({ effective_date: '2026-01-01' }),
    ]);
  });
});
