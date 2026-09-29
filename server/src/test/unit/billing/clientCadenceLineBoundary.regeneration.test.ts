import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * alga-2026-0002499: a client-cadence line that starts mid-cycle must get its
 * first partial service period even when a *sibling* contract of the same
 * client is already billed in advance through the current cycle. The
 * "already billed" boundary protects each line's own history only.
 *
 * DB-free: `tenantDb` is replaced with a tiny in-memory interpreter that
 * evaluates the where-clauses the regeneration issues against fixture rows.
 * Unknown query methods throw so a query-shape change is loud, not silent.
 */

type Row = Record<string, any>;
type Predicate = (row: Row) => boolean;

const fixtures: {
  obligations: Row[];
  // recurring_service_periods rows, pre-joined with `owner_client_id`
  // (the contract owner that the real query reaches via contract_lines/contracts).
  periods: Row[];
  inserted: Row[];
} = { obligations: [], periods: [], inserted: [] };

const col = (name: string) => name.split('.').pop() as string;

class FakeQuery {
  private ops: Array<{ join: 'and' | 'or'; test: Predicate }> = [];
  private ordering: Array<{ column: string; dir: 'asc' | 'desc' }> = [];
  private projection: unknown[] | null = null;
  private firstOnly = false;

  constructor(private readonly tableName: string) {}

  private add(join: 'and' | 'or', test: Predicate) {
    this.ops.push({ join, test });
    return this;
  }

  private whereImpl(join: 'and' | 'or', ...args: any[]) {
    const [first, second] = args;
    if (typeof first === 'function') {
      const group = new FakeQuery(this.tableName);
      first(group);
      return this.add(join, (row) => group.matches(row));
    }
    if (typeof first === 'object') {
      return this.add(join, (row) =>
        Object.entries(first).every(([key, value]) => row[col(key)] === value));
    }
    if (args.length !== 2) {
      throw new Error(`FakeQuery.where unsupported arity ${args.length}`);
    }
    return this.add(join, (row) => row[col(first)] === second);
  }

  where(...args: any[]) { return this.whereImpl('and', ...args); }
  andWhere(...args: any[]) { return this.whereImpl('and', ...args); }
  orWhere(...args: any[]) { return this.whereImpl('or', ...args); }
  whereNull(column: string) { return this.add('and', (row) => row[col(column)] == null); }
  orWhereNull(column: string) { return this.add('or', (row) => row[col(column)] == null); }
  whereNotNull(column: string) { return this.add('and', (row) => row[col(column)] != null); }
  orWhereNotNull(column: string) { return this.add('or', (row) => row[col(column)] != null); }
  whereNotIn(column: string, values: unknown[]) {
    return this.add('and', (row) => !values.includes(row[col(column)]));
  }
  orderBy(column: string, dir: 'asc' | 'desc' = 'asc') {
    this.ordering.push({ column: col(column), dir });
    return this;
  }
  select(...args: unknown[]) { this.projection = args; return this; }
  first() { this.firstOnly = true; return this; }

  matches(row: Row) {
    let result = true;
    this.ops.forEach((op, index) => {
      const value = op.test(row);
      result = index === 0 ? value : op.join === 'and' ? result && value : result || value;
    });
    return result;
  }

  private source(): Row[] {
    switch (this.tableName) {
      case 'client_contracts as cc':
        // Obligation loader: filters are not interpreted, fixtures are pre-filtered.
        return fixtures.obligations;
      case 'recurring_service_periods as rsp':
      case 'recurring_service_periods':
        return fixtures.periods;
      default:
        throw new Error(`FakeQuery: unexpected table ${this.tableName}`);
    }
  }

  private project(row: Row): Row {
    if (!this.projection || this.projection.length === 0) return row;
    const out: Row = {};
    for (const arg of this.projection) {
      if (typeof arg === 'string') {
        const [rawColumn, alias] = arg.split(/\s+as\s+/i);
        out[alias ?? col(rawColumn)] = row[col(rawColumn)];
      } else if (arg && typeof arg === 'object') {
        for (const [alias, rawColumn] of Object.entries(arg)) {
          out[alias] = row[col(rawColumn as string)];
        }
      }
    }
    return out;
  }

  private run() {
    // Obligations are not filtered (see source()); everything else is interpreted.
    const filtered = this.tableName === 'client_contracts as cc'
      ? [...this.source()]
      : this.source().filter((row) => this.matches(row));
    for (const { column, dir } of [...this.ordering].reverse()) {
      filtered.sort((a, b) => {
        const left = String(a[column] ?? '');
        const right = String(b[column] ?? '');
        return dir === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    const projected = filtered.map((row) => this.project(row));
    return this.firstOnly ? projected[0] : projected;
  }

  async insert(rows: Row[]) { fixtures.inserted.push(...rows); }
  async update() { return 1; }

  then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
    try {
      return Promise.resolve(this.run()).then(resolve, reject);
    } catch (error) {
      return Promise.reject(error).then(resolve, reject);
    }
  }
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => new FakeQuery(name),
    tenantJoin: (query: unknown) => query,
  }),
}));

const TENANT = 'tenant-1';
const CLIENT = 'client-1';
const ANCHOR = { dayOfMonth: 1, monthOfYear: null, dayOfWeek: null, referenceDate: null };

const LINE_A = 'line-a-advance-billed';
const LINE_B = 'line-b-new';

function billedPeriodRow(overrides: Row): Row {
  return {
    record_id: `rec-${overrides.obligation_id}`,
    tenant: TENANT,
    schedule_key: `schedule:${TENANT}:client_contract_line:${overrides.obligation_id}:client:${overrides.due_position}`,
    period_key: 'period:2026-03-01:2026-04-01',
    revision: 1,
    obligation_type: 'client_contract_line',
    charge_family: 'fixed',
    cadence_owner: 'client',
    due_position: 'advance',
    lifecycle_state: 'billed',
    service_period_start: '2026-03-01',
    service_period_end: '2026-04-01',
    invoice_window_start: '2026-03-01',
    invoice_window_end: '2026-04-01',
    activity_window_start: null,
    activity_window_end: null,
    timing_metadata: null,
    provenance_kind: 'generated',
    source_rule_version: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
    reason_code: 'initial_materialization',
    source_run_key: 'seed',
    supersedes_record_id: null,
    invoice_id: 'inv-1',
    invoice_charge_id: `chg-${overrides.obligation_id}`,
    invoice_charge_detail_id: `det-${overrides.obligation_id}`,
    invoice_linked_at: '2026-03-01T00:00:00.000Z',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    owner_client_id: CLIENT,
    ...overrides,
  };
}

function obligation(lineId: string, timing: 'advance' | 'arrears', startDate: string): Row {
  return {
    contract_line_id: lineId,
    start_date: startDate,
    end_date: null,
    contract_line_type: 'fixed',
    billing_timing: timing,
  };
}

async function regenerate() {
  const { replenishClientCadenceServicePeriods } = await import(
    '@alga-psa/shared/billingClients/clientCadenceScheduleRegeneration'
  );
  await replenishClientCadenceServicePeriods({} as any, {
    tenant: TENANT,
    clientId: CLIENT,
    billingCycle: 'monthly',
    anchor: ANCHOR,
  });
}

const insertedFor = (lineId: string) =>
  fixtures.inserted
    .filter((row) => row.obligation_id === lineId)
    .sort((a, b) => String(a.service_period_start).localeCompare(String(b.service_period_start)));

describe('client-cadence regeneration boundary is scoped to the line (alga-2026-0002499)', () => {
  beforeEach(() => {
    fixtures.obligations = [];
    fixtures.periods = [];
    fixtures.inserted = [];
    vi.resetModules();
    // Today is mid-cycle: the March cycle (03-01 -> 04-01) is current.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-20T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advance line B starting mid-cycle gets its partial first period (activity window 03-15 -> 04-01) even though sibling line A is billed through the cycle end', async () => {
    fixtures.periods = [billedPeriodRow({ obligation_id: LINE_A, due_position: 'advance' })];
    fixtures.obligations = [
      obligation(LINE_A, 'advance', '2026-03-01'),
      obligation(LINE_B, 'advance', '2026-03-15'),
    ];

    await regenerate();

    const [first, second] = insertedFor(LINE_B);
    // The persisted period is the full cycle; the obligation clip bounds its
    // activity window to start date -> cycle end. The invoice engine prorates from
    // that activity window (partial coverage / full cycle), so this row IS the
    // partial first period.
    expect(first).toMatchObject({
      due_position: 'advance',
      service_period_start: '2026-03-01',
      service_period_end: '2026-04-01',
      activity_window_start: '2026-03-15T00:00:00Z',
      activity_window_end: '2026-04-01',
      // Advance: invoiced on the current cycle's invoice.
      invoice_window_start: '2026-03-01',
      invoice_window_end: '2026-04-01',
    });
    expect(second).toMatchObject({
      service_period_start: '2026-04-01',
      service_period_end: '2026-05-01',
    });

    // Proration: the billing engine feeds (servicePeriod, activityWindow) of the
    // persisted row to calculateServicePeriodCoverage -> coverageRatio. Mar 15 ->
    // Apr 1 is 17 of the cycle's 31 days.
    const { calculateServicePeriodCoverage } = await import(
      '@alga-psa/shared/billingClients/recurringTiming'
    );
    const coverage = calculateServicePeriodCoverage(
      {
        kind: 'service_period',
        cadenceOwner: 'client',
        duePosition: 'advance',
        sourceObligation: { obligationId: LINE_B, obligationType: 'client_contract_line', chargeFamily: 'fixed' },
        start: first.service_period_start,
        end: first.service_period_end,
        semantics: 'half_open',
      } as any,
      { start: first.activity_window_start, end: first.activity_window_end },
    );
    expect(coverage.coverageRatio).toBeCloseTo(17 / 31, 10);
  });

  it('arrears line B starting mid-cycle gets its first partial period, invoiced on the next cycle', async () => {
    fixtures.periods = [billedPeriodRow({ obligation_id: LINE_A, due_position: 'advance' })];
    fixtures.obligations = [
      obligation(LINE_A, 'advance', '2026-03-01'),
      obligation(LINE_B, 'arrears', '2026-03-15'),
    ];

    await regenerate();

    const [first] = insertedFor(LINE_B);
    expect(first).toMatchObject({
      due_position: 'arrears',
      service_period_start: '2026-03-01',
      service_period_end: '2026-04-01',
      activity_window_start: '2026-03-15T00:00:00Z',
      activity_window_end: '2026-04-01',
      // Arrears (the default): lands on the next cycle's invoice, by design.
      invoice_window_start: '2026-04-01',
      invoice_window_end: '2026-05-01',
    });
  });

  it('a line with its own billed history is never regenerated before its own billed end', async () => {
    fixtures.periods = [billedPeriodRow({ obligation_id: LINE_A, due_position: 'advance' })];
    fixtures.obligations = [obligation(LINE_A, 'advance', '2026-03-01')];

    await regenerate();

    const rows = insertedFor(LINE_A);
    expect(rows.length).toBeGreaterThan(0);
    // Nothing that starts before, or duplicates, the billed 03-01 -> 04-01 period.
    expect(rows.every((row) => String(row.service_period_start) >= '2026-04-01')).toBe(true);
    expect(rows.some((row) => row.period_key === 'period:2026-03-01:2026-04-01')).toBe(false);
    expect(rows[0]).toMatchObject({ service_period_start: '2026-04-01' });
  });

  it("a sibling's billing history does not move a line that has its own history", async () => {
    // Line A (own history through 04-01) and line C (own history through 03-01 only,
    // e.g. an arrears line whose March period is not yet invoiced).
    fixtures.periods = [
      billedPeriodRow({ obligation_id: LINE_A, due_position: 'advance' }),
      billedPeriodRow({
        obligation_id: 'line-c-arrears',
        due_position: 'arrears',
        period_key: 'period:2026-02-01:2026-03-01',
        service_period_start: '2026-02-01',
        service_period_end: '2026-03-01',
        invoice_window_start: '2026-03-01',
        invoice_window_end: '2026-04-01',
      }),
    ];
    fixtures.obligations = [
      obligation(LINE_A, 'advance', '2026-01-01'),
      obligation('line-c-arrears', 'arrears', '2026-01-01'),
    ];

    await regenerate();

    expect(insertedFor(LINE_A)[0]).toMatchObject({ service_period_start: '2026-04-01' });
    // C's own boundary is 03-01, so its unbilled March period is still generated.
    expect(insertedFor('line-c-arrears')[0]).toMatchObject({
      service_period_start: '2026-03-01',
      service_period_end: '2026-04-01',
    });
  });
});
