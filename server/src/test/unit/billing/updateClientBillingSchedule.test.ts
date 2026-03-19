import { describe, expect, it, vi, beforeEach } from 'vitest';

type Call =
  | { table: string; method: 'update'; args: unknown[]; where?: unknown[]; andWhere?: unknown[] }
  | { table: string; method: 'select'; args: unknown[]; where?: unknown[]; andWhere?: unknown[] }
  | { table: string; method: 'insert'; args: unknown[]; where?: unknown[]; andWhere?: unknown[] };

class FakeQuery {
  private readonly calls: Call[];
  private readonly table: string;
  private readonly responses: Record<string, any>;
  private whereClauses: unknown[] = [];
  private andWhereClauses: unknown[] = [];
  private isFirst = false;

  constructor(table: string, calls: Call[], responses: Record<string, any>) {
    this.table = table;
    this.calls = calls;
    this.responses = responses;
  }

  where(...args: unknown[]): this {
    this.whereClauses.push(args);
    return this;
  }

  andWhere(...args: unknown[]): this {
    this.andWhereClauses.push(args);
    return this;
  }

  whereIn(): this {
    return this;
  }

  whereNotNull(): this {
    return this;
  }

  leftJoin(): this {
    return this;
  }

  join(_table: string, onFn: Function): this {
    const clause = {
      on: () => clause,
      andOn: () => clause,
    };
    onFn.call(clause);
    return this;
  }

  orderBy(): this {
    return this;
  }

  first(): this {
    this.isFirst = true;
    return this;
  }

  select(...args: unknown[]): any {
    this.calls.push({ table: this.table, method: 'select', args, where: this.whereClauses, andWhere: this.andWhereClauses });
    const key = `${this.table}:select:${this.isFirst ? 'first' : 'many'}`;
    return Promise.resolve(this.responses[key]);
  }

  whereNotExists(subqueryFn: Function): this {
    const builder = {
      select: () => builder,
      from: () => builder,
      whereRaw: () => builder,
      andWhereRaw: () => builder,
    };
    subqueryFn.call(builder);
    return this;
  }

  update(...args: unknown[]): any {
    this.calls.push({ table: this.table, method: 'update', args, where: this.whereClauses, andWhere: this.andWhereClauses });
    return Promise.resolve(1);
  }

  insert(...args: unknown[]): any {
    this.calls.push({ table: this.table, method: 'insert', args, where: this.whereClauses, andWhere: this.andWhereClauses });
    return Promise.resolve(1);
  }
}

function makeFakeTransaction(responses: Record<string, any>): { trx: any; calls: Call[] } {
  const calls: Call[] = [];
  const trx: any = (table: string) => new FakeQuery(table, calls, responses);
  trx.fn = { now: () => 'NOW' };
  return { trx, calls };
}

let currentTrx: any | null = null;

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_knex: any, fn: any) => {
    if (!currentTrx) throw new Error('No test transaction configured');
    return await fn(currentTrx);
  },
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'user-1',
          tenant: 'tenant-1',
        },
        { tenant: 'tenant-1' },
        ...args,
      ),
  getSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}));

const mockEnsureClientBillingSettingsRow = vi.fn(async () => undefined);

vi.mock('../../../../../packages/billing/src/actions/billingCycleAnchorActions', async () => {
  const actual = await vi.importActual<any>('../../../../../packages/billing/src/actions/billingCycleAnchorActions');
  return {
    ...actual,
    ensureClientBillingSettingsRow: (...args: any[]) => mockEnsureClientBillingSettingsRow(...args),
  };
});

describe('updateClientBillingSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTrx = null;
    vi.resetModules();
  });

  it('T052: updates billing schedule settings and regenerates future recurring service periods beyond billed history instead of mutating future client_billing_cycles', async () => {
    const responses = {
      'clients:select:first': { client_id: 'client-1', billing_cycle: 'monthly' },
      'client_billing_cycles as cbc:select:first': { period_end_date: '2026-01-10T00:00:00Z' },
      'client_contract_lines as ccl:select:many': [
        {
          client_contract_line_id: 'line-1',
          start_date: '2025-01-10T00:00:00Z',
          end_date: null,
          contract_line_type: 'Fixed',
          billing_timing: 'arrears',
        },
      ],
      'recurring_service_periods:select:many': [
        {
          record_id: 'rsp-1',
          tenant: 'tenant-1',
          schedule_key: 'schedule:tenant-1:client_contract_line:line-1:client:arrears',
          period_key: 'period:2026-01-10:2026-02-10',
          revision: 1,
          obligation_id: 'line-1',
          obligation_type: 'client_contract_line',
          charge_family: 'fixed',
          cadence_owner: 'client',
          due_position: 'arrears',
          lifecycle_state: 'generated',
          service_period_start: '2026-01-10',
          service_period_end: '2026-02-10',
          invoice_window_start: '2026-02-10',
          invoice_window_end: '2026-03-10',
          activity_window_start: null,
          activity_window_end: null,
          timing_metadata: null,
          provenance_kind: 'generated',
          source_rule_version: 'legacy',
          reason_code: 'initial_materialization',
          source_run_key: 'legacy-run',
          supersedes_record_id: null,
          invoice_id: null,
          invoice_charge_id: null,
          invoice_charge_detail_id: null,
          invoice_linked_at: null,
          created_at: '2025-12-01T00:00:00Z',
          updated_at: '2025-12-01T00:00:00Z',
        },
      ],
    };
    const { trx, calls } = makeFakeTransaction(responses);
    currentTrx = trx;
    const { updateClientBillingSchedule: updateWithMock } = await import('../../../../../packages/billing/src/actions/billingScheduleActions');

    await updateWithMock({
      clientId: 'client-1',
      billingCycle: 'quarterly',
      anchor: { monthOfYear: 1, dayOfMonth: 10 }
    });

    expect(mockEnsureClientBillingSettingsRow).toHaveBeenCalled();

    const clientUpdate = calls.find(c => c.method === 'update' && c.table === 'clients') as any;
    expect(clientUpdate).toBeTruthy();
    expect(clientUpdate.args[0]).toMatchObject({ billing_cycle: 'quarterly' });

    const settingsUpdate = calls.find(c => c.method === 'update' && c.table === 'client_billing_settings') as any;
    expect(settingsUpdate).toBeTruthy();
    expect(settingsUpdate.args[0]).toMatchObject({
      billing_cycle_anchor_day_of_month: 10,
      billing_cycle_anchor_month_of_year: 1,
    });

    const supersedeUpdate = calls.find(
      c => c.method === 'update' && c.table === 'recurring_service_periods',
    ) as any;
    expect(supersedeUpdate).toBeTruthy();
    expect(supersedeUpdate.args[0]).toMatchObject({ lifecycle_state: 'superseded' });

    const regeneratedInsert = calls.find(
      c => c.method === 'insert' && c.table === 'recurring_service_periods',
    ) as any;
    expect(regeneratedInsert).toBeTruthy();
    const insertedRows = regeneratedInsert.args[0];
    expect(Array.isArray(insertedRows)).toBe(true);
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          obligation_id: 'line-1',
          obligation_type: 'client_contract_line',
          cadence_owner: 'client',
          due_position: 'arrears',
          provenance_kind: 'regenerated',
          reason_code: 'billing_schedule_changed',
          supersedes_record_id: 'rsp-1',
        }),
      ]),
    );
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          obligation_id: 'line-1',
          obligation_type: 'client_contract_line',
          cadence_owner: 'client',
          due_position: 'arrears',
          provenance_kind: 'generated',
          reason_code: 'backfill_materialization',
        }),
      ]),
    );

    const deactivateUpdate = calls.find(
      c => c.method === 'update' && c.table === 'client_billing_cycles',
    ) as any;
    expect(deactivateUpdate).toBeFalsy();
  });

  it('T053: legitimate client billing schedule management still updates client settings while regenerating recurring service periods', async () => {
    const responses = {
      'clients:select:first': { client_id: 'client-1', billing_cycle: 'monthly' },
      'client_billing_cycles as cbc:select:first': null,
      'client_contract_lines as ccl:select:many': [
        {
          client_contract_line_id: 'line-1',
          start_date: '2025-01-01T00:00:00Z',
          end_date: null,
          contract_line_type: 'Fixed',
          billing_timing: 'arrears',
        },
      ],
      'recurring_service_periods:select:many': [],
    };
    const { trx, calls } = makeFakeTransaction(responses);
    currentTrx = trx;
    const { updateClientBillingSchedule: updateWithMock } = await import('../../../../../packages/billing/src/actions/billingScheduleActions');

    await updateWithMock({
      clientId: 'client-1',
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 10 }
    });

    const clientUpdate = calls.find(c => c.method === 'update' && c.table === 'clients') as any;
    expect(clientUpdate).toBeFalsy();

    const regeneratedInsert = calls.find(
      c => c.method === 'insert' && c.table === 'recurring_service_periods',
    ) as any;
    expect(regeneratedInsert).toBeTruthy();
    expect(regeneratedInsert.args[0][0]).toMatchObject({
      obligation_id: 'line-1',
      cadence_owner: 'client',
      provenance_kind: 'generated',
      reason_code: 'backfill_materialization',
    });

    const deactivateUpdate = calls.find(
      c => c.method === 'update' && c.table === 'client_billing_cycles',
    ) as any;
    expect(deactivateUpdate).toBeFalsy();
  });
});
