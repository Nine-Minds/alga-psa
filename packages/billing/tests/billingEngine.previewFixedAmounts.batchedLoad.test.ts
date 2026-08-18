import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const store = vi.hoisted(() => ({
  rowsByTable: {} as Record<string, Row[]>,
  tableCalls: [] as string[],
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    tenantDb: (conn: any, _tenant: string) => ({
      table: (table: string) => conn(table),
      tenantJoin: (query: any) => query,
    }),
  };
});

vi.mock('@alga-psa/shared/billingClients', async () => {
  const actual = await vi.importActual<any>('@alga-psa/shared/billingClients');
  return {
    ...actual,
    getClientDefaultTaxRegionCode: vi.fn(async () => 'US-NY'),
  };
});

function normalizeColumn(column: string): string {
  return column.split(/\s+as\s+/i)[0].split('.').pop()!.trim();
}

function projectRow(row: Row, columns: any[]): Row {
  if (columns.length === 0) {
    return { ...row };
  }
  const projected: Row = {};
  for (const column of columns) {
    const expression = typeof column === 'string' ? column : column?.__raw;
    if (typeof expression !== 'string') {
      continue;
    }
    const [source, alias] = expression.split(/\s+as\s+/i);
    const sourceKey = source.split('.').pop()!.trim();
    projected[(alias ?? sourceKey).trim()] = row[sourceKey];
  }
  return projected;
}

function matchesCriteria(row: Row, criteria: Record<string, any>): boolean {
  return Object.entries(criteria).every(
    ([column, value]) => row[normalizeColumn(column)] === value,
  );
}

function compare(left: any, right: any): number {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  return String(left).localeCompare(String(right));
}

function createBuilder(rows: Row[]) {
  let resultRows = [...rows];
  let projection: any[] = [];

  const applyNested = (callback: (nested: any) => void) => {
    const clauses: Array<{ type: 'and' | 'or'; predicate: (row: Row) => boolean }> = [];
    const nested: any = {
      where: (column: string, operator?: any, value?: any) => {
        clauses.push({ type: 'and', predicate: (row) => applyOperator(row, column, operator, value) });
        return nested;
      },
      orWhere: (column: string, operator?: any, value?: any) => {
        clauses.push({ type: 'or', predicate: (row) => applyOperator(row, column, operator, value) });
        return nested;
      },
      whereNull: (column: string) => {
        clauses.push({ type: 'and', predicate: (row) => row[normalizeColumn(column)] == null });
        return nested;
      },
      orWhereNull: (column: string) => {
        clauses.push({ type: 'or', predicate: (row) => row[normalizeColumn(column)] == null });
        return nested;
      },
    };
    callback(nested);
    resultRows = resultRows.filter((row) =>
      clauses.reduce(
        (matched, clause) =>
          clause.type === 'and' ? matched && clause.predicate(row) : matched || clause.predicate(row),
        clauses[0]?.type === 'or' ? false : true,
      ),
    );
  };

  const applyOperator = (row: Row, column: string, operator: any, value: any): boolean => {
    const cell = row[normalizeColumn(column)];
    if (value === undefined) {
      return cell === operator;
    }
    switch (operator) {
      case '=':
        return cell === value;
      case '<':
        return String(cell) < String(value);
      case '>':
        return String(cell) > String(value);
      case '<=':
        return String(cell) <= String(value);
      case '>=':
        return String(cell) >= String(value);
      default:
        throw new Error(`Unsupported operator ${operator}`);
    }
  };

  const builder: any = {
    join: () => builder,
    leftJoin: () => builder,
    where: (columnOrCriteria: any, operatorOrValue?: any, maybeValue?: any) => {
      if (typeof columnOrCriteria === 'function') {
        applyNested((nested) => columnOrCriteria.call(nested, nested));
        return builder;
      }
      if (typeof columnOrCriteria === 'object') {
        resultRows = resultRows.filter((row) => matchesCriteria(row, columnOrCriteria));
        return builder;
      }
      resultRows = resultRows.filter((row) =>
        applyOperator(row, columnOrCriteria, operatorOrValue, maybeValue),
      );
      return builder;
    },
    whereIn: (column: string, values: any[]) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => values.includes(row[normalized]));
      return builder;
    },
    whereNotIn: (column: string, values: any[]) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => !values.includes(row[normalized]));
      return builder;
    },
    whereNot: (column: string, value: any) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalized] !== value);
      return builder;
    },
    whereNull: (column: string) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalized] == null);
      return builder;
    },
    orderBy: (column: string, direction: 'asc' | 'desc' = 'asc') => {
      const normalized = normalizeColumn(column);
      resultRows = [...resultRows].sort((left, right) => {
        const comparison = compare(left[normalized], right[normalized]);
        return direction === 'desc' ? -comparison : comparison;
      });
      return builder;
    },
    select: (...columns: any[]) => {
      projection = columns.flat();
      return builder;
    },
    first: async (...columns: any[]) => {
      const selected = columns.flat();
      const row = resultRows[0];
      return row ? projectRow(row, selected.length > 0 ? selected : projection) : undefined;
    },
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultRows.map((row) => projectRow(row, projection))).then(resolve, reject),
  };

  return builder;
}

const knexMock: any = vi.fn((table: string) => {
  const normalized = table.split(/\s+as\s+/i)[0].trim();
  store.tableCalls.push(normalized);
  return createBuilder(store.rowsByTable[normalized] ?? []);
});
knexMock.raw = (sql: string) => ({ __raw: sql });

const TENANT = 'tenant-1';
const CLIENT_ID = 'client-1';
const WINDOW_START = '2025-03-01';
const WINDOW_END = '2025-04-01';

const contractLine = (
  contractLineId: string,
  contractId: string,
  customRate: number | null,
) => ({
  tenant: TENANT,
  client_id: CLIENT_ID,
  is_active: true,
  start_date: '2024-01-01',
  end_date: null,
  client_contract_id: `cc-${contractLineId}`,
  template_contract_id: null,
  contract_id: contractId,
  contract_name: `Contract ${contractId}`,
  is_system_managed_default: false,
  currency_code: 'USD',
  contract_line_id: contractLineId,
  contract_line_name: `Line ${contractLineId}`,
  contract_line_type: 'Fixed',
  service_category: null,
  billing_frequency: 'monthly',
  billing_timing: 'arrears',
  cadence_owner: 'client',
  custom_rate: customRate,
  enable_proration: false,
  location_id: 'loc-1',
});

const servicePeriod = (contractLineId: string) => ({
  tenant: TENANT,
  record_id: `rsp-${contractLineId}`,
  obligation_id: contractLineId,
  obligation_type: 'client_contract_line',
  charge_family: 'fixed',
  cadence_owner: 'client',
  due_position: 'arrears',
  lifecycle_state: 'generated',
  revision: 1,
  service_period_start: WINDOW_START,
  service_period_end: WINDOW_END,
  activity_window_start: null,
  activity_window_end: null,
  invoice_window_start: WINDOW_START,
  invoice_window_end: WINDOW_END,
  invoice_charge_detail_id: null,
});

const planService = (
  contractLineId: string,
  serviceId: string,
  overrides: Partial<Row> = {},
) => ({
  tenant: TENANT,
  contract_line_id: contractLineId,
  configuration_type: 'Fixed',
  item_kind: 'service',
  service_id: serviceId,
  service_name: `Service ${serviceId}`,
  default_rate: 0,
  tax_rate_id: null,
  quantity: 1,
  custom_rate: null,
  config_id: `cfg-${contractLineId}`,
  base_rate: null,
  ...overrides,
});

async function createEngine() {
  const { BillingEngine } = await import('../src/lib/billing/billingEngine');
  const engine = new BillingEngine();
  (engine as any).knex = knexMock;
  (engine as any).tenant = TENANT;
  return engine as any;
}

/** Reproduces the pre-batching path: one calculateFixedPriceCharges per line. */
async function priceLinesIndividually(engine: any) {
  const billingPeriod = { tenant: TENANT, startDate: WINDOW_START, endDate: WINDOW_END };
  const lines = await engine.getClientContractLinesForBillingPeriod(CLIENT_ID, billingPeriod);
  const selections = await engine.loadPersistedRecurringTimingSelections(billingPeriod, lines);
  const amounts = new Map<string, number>();
  for (const line of lines) {
    if (String(line.contract_line_type ?? '').toLowerCase() !== 'fixed') continue;
    const selection = selections?.[line.client_contract_line_id];
    if (!selection) continue;
    const charges = await engine.calculateFixedPriceCharges(
      CLIENT_ID,
      billingPeriod,
      line,
      undefined,
      selection,
      'persisted',
    );
    if (charges.length === 0) continue;
    const total = charges.reduce((sum: number, charge: any) => sum + (charge.total ?? 0), 0);
    amounts.set(String(line.contract_line_id), total);
    amounts.set(String(line.client_contract_line_id), total);
  }
  return amounts;
}

describe('previewFixedChargeAmountsForInvoiceWindow batched load', () => {
  beforeEach(() => {
    store.tableCalls.length = 0;
    store.rowsByTable = {
      clients: [
        {
          tenant: TENANT,
          client_id: CLIENT_ID,
          client_name: 'Acme Co',
          is_tax_exempt: false,
          region_code: 'US-NY',
        },
      ],
      client_contracts: [
        contractLine('line-custom', 'contract-1', 50000),
        contractLine('line-schedule', 'contract-2', 20000),
        contractLine('line-base', 'contract-3', null),
        contractLine('line-dead', 'contract-4', null),
      ],
      contract_lines: [
        {
          tenant: TENANT,
          contract_line_id: 'line-custom',
          contract_line_type: 'Fixed',
          custom_rate: 50000,
          enable_proration: false,
        },
        {
          tenant: TENANT,
          contract_line_id: 'line-schedule',
          contract_line_type: 'Fixed',
          custom_rate: 20000,
          enable_proration: false,
        },
        {
          tenant: TENANT,
          contract_line_id: 'line-base',
          contract_line_type: 'Fixed',
          custom_rate: null,
          enable_proration: false,
        },
        {
          tenant: TENANT,
          contract_line_id: 'line-dead',
          contract_line_type: 'Fixed',
          custom_rate: null,
          enable_proration: false,
        },
      ],
      contract_line_services: [
        planService('line-custom', 'svc-custom', { default_rate: 50000 }),
        planService('line-schedule', 'svc-schedule', { default_rate: 20000 }),
        planService('line-base', 'svc-base', {
          base_rate: 7500,
          default_rate: 7500,
          quantity: 2,
        }),
        // No base rate and no catalog default rate: unpriceable in every window.
        planService('line-dead', 'svc-dead'),
      ],
      contract_pricing_schedules: [
        {
          tenant: TENANT,
          schedule_id: 'schedule-1',
          contract_id: 'contract-2',
          custom_rate: 30000,
          effective_date: '2025-01-01',
          end_date: null,
        },
      ],
      recurring_service_periods: [
        servicePeriod('line-custom'),
        servicePeriod('line-schedule'),
        servicePeriod('line-base'),
        servicePeriod('line-dead'),
      ],
      client_locations: [{ tenant: TENANT, location_id: 'loc-1', region_code: 'US-NY' }],
      client_tax_settings: [
        { tenant: TENANT, client_id: CLIENT_ID, is_reverse_charge_applicable: false },
      ],
      tax_rates: [],
    };
  });

  it('prices custom-rate, pricing-schedule and service-base-rate lines and skips unpriceable ones', async () => {
    const engine = await createEngine();

    const amounts = await engine.previewFixedChargeAmountsForInvoiceWindow(
      CLIENT_ID,
      WINDOW_START,
      WINDOW_END,
    );

    expect(amounts.get('line-custom')).toBe(50000);
    expect(amounts.get('line-schedule')).toBe(30000);
    expect(amounts.get('line-base')).toBe(15000);
    expect(amounts.has('line-dead')).toBe(false);
  });

  it('matches the per-line load path amount for amount', async () => {
    const batchedEngine = await createEngine();
    const batched = await batchedEngine.previewFixedChargeAmountsForInvoiceWindow(
      CLIENT_ID,
      WINDOW_START,
      WINDOW_END,
    );

    const perLineEngine = await createEngine();
    const perLine = await priceLinesIndividually(perLineEngine);

    expect(Object.fromEntries(batched)).toEqual(Object.fromEntries(perLine));
  });

  it('loads line details, services and pricing schedules once per window', async () => {
    const engine = await createEngine();

    await engine.previewFixedChargeAmountsForInvoiceWindow(CLIENT_ID, WINDOW_START, WINDOW_END);

    const countOf = (table: string) => store.tableCalls.filter((name) => name === table).length;
    expect(countOf('contract_lines')).toBe(1);
    expect(countOf('contract_line_services')).toBe(1);
    expect(countOf('contract_pricing_schedules')).toBe(1);
    expect(countOf('client_tax_settings')).toBe(1);
  });

  it('never recomputes an unpriceable line across windows sharing a session', async () => {
    const engine = await createEngine();
    const { createFixedChargePreviewSession } = await import('../src/lib/billing/billingEngine');
    const session = createFixedChargePreviewSession();
    const baseRateError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await engine.previewFixedChargeAmountsForInvoiceWindow(
      CLIENT_ID,
      WINDOW_START,
      WINDOW_END,
      session,
    );
    const callsAfterFirstWindow = store.tableCalls.length;
    await engine.previewFixedChargeAmountsForInvoiceWindow(
      CLIENT_ID,
      WINDOW_START,
      WINDOW_END,
      session,
    );
    const secondWindowCalls = store.tableCalls.slice(callsAfterFirstWindow);

    expect(secondWindowCalls).not.toContain('contract_lines');
    expect(secondWindowCalls).not.toContain('contract_line_services');
    expect(session.get('line-dead')?.unpriceable).toBe(true);
    expect(
      baseRateError.mock.calls.filter(([message]) =>
        String(message).includes('Unable to determine base_rate'),
      ),
    ).toHaveLength(0);

    baseRateError.mockRestore();
  });
});
