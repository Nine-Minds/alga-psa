import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

let fixtures: Record<string, Row[]>;

const fakeTrx = {
  raw: (sql: string) => ({ sql }),
};

/**
 * Minimal query double that honours the `.select()` projection: a row only
 * exposes the columns the reader asked for. That makes an omitted projection
 * column observable in the output instead of silently returning the full row.
 */
class FakeQuery {
  private requested: string[] | null = null;

  constructor(private readonly rows: Row[]) {}

  where() {
    return this;
  }

  leftJoin() {
    return this;
  }

  orderBy() {
    return this;
  }

  select(columns: unknown, ...rest: unknown[]) {
    const list = Array.isArray(columns) ? columns : [columns, ...rest];
    this.requested = list.filter((column): column is string => typeof column === 'string');
    return this;
  }

  first() {
    return Promise.resolve(this.rows[0]);
  }

  then(resolve: (value: Row[]) => unknown, reject?: (error: unknown) => unknown) {
    return Promise.resolve(this.rows.map((row) => this.project(row))).then(resolve, reject);
  }

  private project(row: Row): Row {
    if (!this.requested) return { ...row };
    const projected: Row = {};
    for (const column of this.requested) {
      const match = column.match(/^\s*([A-Za-z_][\w.]*)\.([A-Za-z_][\w]*)(?:\s+as\s+([A-Za-z_][\w]*))?\s*$/i);
      const source = match ? match[2] : column;
      const key = match?.[3] ?? source;
      projected[key] = row[key] ?? row[source] ?? null;
    }
    return projected;
  }
}

function route(table: string): FakeQuery {
  return new FakeQuery(fixtures[table] ?? []);
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: fakeTrx, tenant: 'tenant-1' }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn(fakeTrx),
  tenantDb: () => ({
    table: (table: string) => route(table),
    unscoped: (table: string) => route(table),
    tenantJoin: (query: unknown) => query,
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: any) =>
    (...args: any[]) =>
      action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('../src/lib/authHelpers', () => ({
  getAnalyticsAsync: vi.fn(),
}));

const LIVE_ROW: Row = {
  tenant: 'tenant-1',
  contract_id: 'contract-1',
  contract_line_id: 'line-1',
  display_order: 0,
  custom_rate: 250,
  rate_provenance: 'custom',
  cadence_owner: 'client',
  billing_timing: 'arrears',
  invoice_line_description: 'Managed services — September',
  start_date: new Date('2026-09-24T00:00:00.000Z'),
  end_date: '2026-12-31T00:00:00.000Z',
  created_at: '2026-09-01T00:00:00.000Z',
  contract_line_name: 'Managed Services',
  billing_frequency: 'monthly',
  is_custom: true,
  contract_line_type: 'Fixed',
  minimum_billable_time: null,
  round_up_to_nearest: null,
  default_rate: 250,
  location_id: null,
};

describe('detailed contract-line read path preserves invoice text and line window', () => {
  beforeEach(() => {
    fixtures = {};
  });

  it('projects invoice_line_description, start_date and end_date on live lines and normalizes the dates for the date inputs', async () => {
    fixtures['contract_templates'] = [];
    fixtures['contract_lines as cl'] = [LIVE_ROW];

    const { getDetailedContractLines } = await import('../src/actions/contractLineMappingActions');
    const result = await getDetailedContractLines('contract-1');

    expect(Array.isArray(result)).toBe(true);
    const [line] = result as Row[];

    expect(line.invoice_line_description).toBe('Managed services — September');
    expect(line.start_date).toBe('2026-09-24');
    expect(line.end_date).toBe('2026-12-31');
  });

  it('keeps null line dates null instead of fabricating a value', async () => {
    fixtures['contract_templates'] = [];
    fixtures['contract_lines as cl'] = [{ ...LIVE_ROW, start_date: null, end_date: null }];

    const { getDetailedContractLines } = await import('../src/actions/contractLineMappingActions');
    const result = await getDetailedContractLines('contract-1');

    const [line] = result as Row[];
    expect(line.start_date).toBeNull();
    expect(line.end_date).toBeNull();
  });

  it('projects invoice_line_description on template lines', async () => {
    fixtures['contract_templates'] = [{ template_id: 'template-1' }];
    fixtures['contract_template_lines as lines'] = [
      {
        tenant: 'tenant-1',
        contract_id: 'template-1',
        contract_line_id: 'template-line-1',
        display_order: 0,
        custom_rate: null,
        cadence_owner: 'client',
        invoice_line_description: 'Template invoice text',
        created_at: '2026-09-01T00:00:00.000Z',
        contract_line_name: 'Template line',
        billing_frequency: 'monthly',
        contract_line_type: 'Fixed',
        minimum_billable_time: null,
        round_up_to_nearest: null,
        default_rate: 100,
      },
    ];

    const { getDetailedContractLines } = await import('../src/actions/contractLineMappingActions');
    const result = await getDetailedContractLines('template-1');

    const [line] = result as Row[];
    expect(line.invoice_line_description).toBe('Template invoice text');
  });
});
