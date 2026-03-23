import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

function normalizeTableName(tableName: string): string {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function normalizeColumn(column: string): string {
  return column
    .replace(/^LOWER\(/i, '')
    .replace(/^DATE\(/i, '')
    .replace(/\)$/g, '')
    .replace(/^.*\./, '')
    .replace(/\s+as\s+.*$/i, '')
    .trim();
}

function compareValues(left: any, right: any) {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return -1;
  }
  if (right == null) {
    return 1;
  }
  return String(left).localeCompare(String(right));
}

function applyOperator(rowValue: any, operator: string, expected: any) {
  switch (operator) {
    case '=':
      return rowValue === expected;
    case '>=':
      return String(rowValue) >= String(expected);
    case '<=':
      return String(rowValue) <= String(expected);
    case '>':
      return String(rowValue) > String(expected);
    case '<':
      return String(rowValue) < String(expected);
    default:
      throw new Error(`Unsupported operator ${operator}`);
  }
}

function buildPredicate(
  columnOrCriteria: string | Record<string, any>,
  operatorOrValue?: any,
  maybeValue?: any,
) {
  if (typeof columnOrCriteria === 'object') {
    return (row: Row) =>
      Object.entries(columnOrCriteria).every(([column, expected]) =>
        row[normalizeColumn(column)] === expected,
      );
  }

  const column = normalizeColumn(columnOrCriteria);
  const operator = maybeValue === undefined ? '=' : operatorOrValue;
  const expected = maybeValue === undefined ? operatorOrValue : maybeValue;
  return (row: Row) => applyOperator(row[column], operator, expected);
}

function createQueryBuilder(rows: Row[]) {
  let resultRows = [...rows];

  const builder: any = {
    join: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    select: vi.fn(() => builder),
    where: vi.fn((columnOrCriteria: string | Record<string, any> | ((nestedBuilder: any) => void), operatorOrValue?: any, maybeValue?: any) => {
      if (typeof columnOrCriteria === 'function') {
        const clauses: Array<{ type: 'and' | 'or'; predicate: (row: Row) => boolean }> = [];
        const nestedBuilder = {
          where: (nestedColumnOrCriteria: string | Record<string, any>, nestedOperatorOrValue?: any, nestedMaybeValue?: any) => {
            clauses.push({
              type: 'and',
              predicate: buildPredicate(nestedColumnOrCriteria, nestedOperatorOrValue, nestedMaybeValue),
            });
            return nestedBuilder;
          },
          orWhere: (nestedColumnOrCriteria: string | Record<string, any>, nestedOperatorOrValue?: any, nestedMaybeValue?: any) => {
            clauses.push({
              type: 'or',
              predicate: buildPredicate(nestedColumnOrCriteria, nestedOperatorOrValue, nestedMaybeValue),
            });
            return nestedBuilder;
          },
          whereNull: (column: string) => {
            const normalized = normalizeColumn(column);
            clauses.push({
              type: 'and',
              predicate: (row: Row) => row[normalized] == null,
            });
            return nestedBuilder;
          },
          whereNotNull: (column: string) => {
            const normalized = normalizeColumn(column);
            clauses.push({
              type: 'and',
              predicate: (row: Row) => row[normalized] != null,
            });
            return nestedBuilder;
          },
          orWhereNull: (column: string) => {
            const normalized = normalizeColumn(column);
            clauses.push({
              type: 'or',
              predicate: (row: Row) => row[normalized] == null,
            });
            return nestedBuilder;
          },
          orWhereNotNull: (column: string) => {
            const normalized = normalizeColumn(column);
            clauses.push({
              type: 'or',
              predicate: (row: Row) => row[normalized] != null,
            });
            return nestedBuilder;
          },
        };

        columnOrCriteria(nestedBuilder);
        resultRows = resultRows.filter((row) => {
          if (clauses.length === 0) {
            return true;
          }

          return clauses.reduce((matches, clause, index) => {
            const clauseResult = clause.predicate(row);
            if (index === 0) {
              return clauseResult;
            }
            return clause.type === 'or' ? matches || clauseResult : matches && clauseResult;
          }, false);
        });
        return builder;
      }

      const predicate = buildPredicate(columnOrCriteria, operatorOrValue, maybeValue);
      resultRows = resultRows.filter((row) => predicate(row));
      return builder;
    }),
    orWhere: vi.fn((columnOrCriteria: string | Record<string, any>, operatorOrValue?: any, maybeValue?: any) => {
      const predicate = buildPredicate(columnOrCriteria, operatorOrValue, maybeValue);
      const matchingRows = rows.filter((row) => predicate(row));
      const seen = new Set(resultRows);
      resultRows = [...resultRows, ...matchingRows.filter((row) => !seen.has(row))];
      return builder;
    }),
    whereIn: vi.fn((column: string, values: any[]) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => values.includes(row[normalized]));
      return builder;
    }),
    whereNull: vi.fn((column: string) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalized] == null);
      return builder;
    }),
    whereNotNull: vi.fn((column: string) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalized] != null);
      return builder;
    }),
    whereRaw: vi.fn((sql: string, args: any[] = []) => {
      const loweredLikeMatch = sql.match(/LOWER\((.+)\)\s+LIKE\s+\?/i);
      if (loweredLikeMatch) {
        const column = normalizeColumn(loweredLikeMatch[1] ?? '');
        const needle = String(args[0] ?? '').toLowerCase().replaceAll('%', '');
        resultRows = resultRows.filter((row) =>
          String(row[column] ?? '').toLowerCase().includes(needle),
        );
        return builder;
      }

      const dateCompareMatch = sql.match(/DATE\((.+)\)\s*(>=|<=)\s+\?/i);
      if (dateCompareMatch) {
        const column = normalizeColumn(dateCompareMatch[1] ?? '');
        const operator = dateCompareMatch[2] ?? '=';
        const expected = String(args[0] ?? '');
        resultRows = resultRows.filter((row) =>
          applyOperator(String(row[column] ?? '').slice(0, 10), operator, expected),
        );
        return builder;
      }

      throw new Error(`Unsupported whereRaw expression: ${sql}`);
    }),
    orderBy: vi.fn((column: string, direction: 'asc' | 'desc' = 'asc') => {
      const normalized = normalizeColumn(column);
      resultRows = [...resultRows].sort((left, right) => {
        const comparison = compareValues(left[normalized], right[normalized]);
        return direction === 'desc' ? -comparison : comparison;
      });
      return builder;
    }),
    limit: vi.fn((count: number) => {
      resultRows = resultRows.slice(0, count);
      return builder;
    }),
    offset: vi.fn((count: number) => {
      resultRows = resultRows.slice(count);
      return builder;
    }),
    count: vi.fn(() => {
      resultRows = [{ count: resultRows.length }];
      return builder;
    }),
    first: vi.fn(async () => resultRows[0]),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultRows).then(resolve, reject),
  };

  return builder;
}

const mocks = vi.hoisted(() => {
  const rowsByTable: Record<string, Row[]> = {};
  const missingTables = new Set<string>();

  const trx = vi.fn((tableName: string) => {
    const normalizedTableName = normalizeTableName(tableName);
    if (missingTables.has(normalizedTableName)) {
      throw new Error(`relation "${normalizedTableName}" does not exist`);
    }

    return createQueryBuilder(rowsByTable[normalizedTableName] ?? []);
  }) as any;
  trx.raw = vi.fn((sql: string) => sql);

  return {
    missingTables,
    rowsByTable,
    trx,
    createTenantKnex: vi.fn(async () => ({ knex: trx })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
      callback(trx),
    ),
  };
});

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
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

const { getAvailableRecurringDueWork } = await import(
  '../../../../../packages/billing/src/actions/billingAndTax'
);

describe('recurring due-work reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.missingTables.clear();

    mocks.rowsByTable.client_billing_cycles = [
      {
        tenant: 'tenant-1',
        client_id: 'client-2',
        client_name: 'Bravo Co',
        billing_cycle_id: 'cycle-2025-02',
        billing_cycle: 'monthly',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01',
        effective_date: '2025-02-01',
        invoice_id: null,
      },
      {
        tenant: 'tenant-1',
        client_id: 'client-3',
        client_name: 'Ignored Invoiced Client',
        billing_cycle_id: 'cycle-ignored',
        billing_cycle: 'monthly',
        period_start_date: '2025-01-01',
        period_end_date: '2025-02-01',
        effective_date: '2025-01-01',
        invoice_id: 'invoice-existing',
      },
    ];

    mocks.rowsByTable.client_contracts = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_contract_line_id: 'assignment-1',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        start_date: '2025-01-01',
        end_date: null,
        is_active: true,
      },
      {
        tenant: 'tenant-1',
        client_id: 'client-2',
        client_contract_line_id: 'assignment-2',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        start_date: '2025-01-01',
        end_date: null,
        is_active: true,
      },
    ];

    mocks.rowsByTable.recurring_service_periods = [
      {
        tenant: 'tenant-1',
        record_id: 'rsp-contract-1',
        schedule_key: 'schedule:tenant-1:contract_line:line-1:contract:arrears',
        period_key: 'period:2025-03-08:2025-04-08',
        lifecycle_state: 'generated',
        cadence_owner: 'contract',
        obligation_type: 'contract_line',
        service_period_start: '2025-03-08',
        service_period_end: '2025-04-08',
        invoice_window_start: '2025-04-08',
        invoice_window_end: '2025-05-08',
        invoice_charge_detail_id: null,
        client_id: 'client-9',
        client_name: 'Zenith Health',
        billing_cycle_id: null,
        contract_id: 'contract-1',
        contract_name: 'Zenith Annual Support',
        contract_line_id: 'line-1',
        contract_line_name: 'Managed Services',
      },
      {
        tenant: 'tenant-1',
        record_id: 'rsp-client-1',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: null,
        contract_id: 'contract-2',
        contract_name: 'Acme Monthly Support',
        contract_line_id: 'assignment-1',
        contract_line_name: 'Acme Retainer',
      },
      {
        tenant: 'tenant-1',
        record_id: 'rsp-client-arrears-1',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-3:client:arrears',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-04-01',
        invoice_window_end: '2025-05-01',
        invoice_charge_detail_id: null,
        client_id: 'client-3',
        client_name: 'Wonder Co',
        billing_cycle_id: null,
        contract_id: 'contract-3',
        contract_name: 'Wonder Retainer',
        contract_line_id: 'assignment-3',
        contract_line_name: 'Wonder Fixed Fee',
      },
      {
        tenant: 'tenant-1',
        record_id: 'rsp-archived',
        schedule_key: 'schedule:tenant-1:contract_line:line-archived:contract:arrears',
        period_key: 'period:2025-01-01:2025-02-01',
        lifecycle_state: 'archived',
        cadence_owner: 'contract',
        obligation_type: 'contract_line',
        service_period_start: '2025-01-01',
        service_period_end: '2025-02-01',
        invoice_window_start: '2025-02-01',
        invoice_window_end: '2025-03-01',
        invoice_charge_detail_id: null,
        client_id: 'client-10',
        client_name: 'Archived Client',
        billing_cycle_id: null,
        contract_id: 'contract-archived',
        contract_name: 'Archived Contract',
        contract_line_id: 'line-archived',
        contract_line_name: 'Archived Line',
      },
    ];
  });

  it('T001/T002: due-work reader loads persisted client-cadence and contract-cadence rows when `client_contract_lines` is absent', async () => {
    mocks.missingTables.add('client_contract_lines');

    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(3);
    expect(result.invoiceCandidates.map((candidate) => ({
      clientName: candidate.clientName,
      cadenceSource: candidate.cadenceSources[0],
      invoiceWindowEnd: candidate.windowEnd,
      executionIdentityKey: candidate.members[0]?.executionIdentityKey,
    }))).toEqual([
      {
        clientName: 'Zenith Health',
        cadenceSource: 'contract_anniversary',
        invoiceWindowEnd: '2025-05-08',
        executionIdentityKey:
          'contract_cadence_window:contract:client-9:contract-1:line-1:2025-04-08:2025-05-08',
      },
      {
        clientName: 'Wonder Co',
        cadenceSource: 'client_schedule',
        invoiceWindowEnd: '2025-05-01',
        executionIdentityKey:
          'client_cadence_window:client:client-3:schedule:tenant-1:client_contract_line:assignment-3:client:arrears:period:2025-03-01:2025-04-01:2025-04-01:2025-05-01',
      },
      {
        clientName: 'Acme Co',
        cadenceSource: 'client_schedule',
        invoiceWindowEnd: '2025-04-01',
        executionIdentityKey:
          'client_cadence_window:client:client-1:schedule:tenant-1:client_contract_line:assignment-1:client:advance:period:2025-03-01:2025-04-01:2025-03-01:2025-04-01',
      },
    ]);
  });

  it('T010: due-work reader pagination remains stable when rows include a mix of bridged and unbridged recurring windows', async () => {
    const firstPage = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 1,
    });
    const secondPage = await getAvailableRecurringDueWork({
      page: 2,
      pageSize: 1,
    });

    expect(firstPage.total).toBe(3);
    expect(firstPage.totalPages).toBe(3);
    expect(firstPage.invoiceCandidates.map((candidate) => candidate.members[0]?.executionIdentityKey)).toEqual([
      'contract_cadence_window:contract:client-9:contract-1:line-1:2025-04-08:2025-05-08',
    ]);
    expect(secondPage.invoiceCandidates.map((candidate) => candidate.members[0]?.executionIdentityKey)).toEqual([
      'client_cadence_window:client:client-3:schedule:tenant-1:client_contract_line:assignment-3:client:arrears:period:2025-03-01:2025-04-01:2025-04-01:2025-05-01',
    ]);
    const thirdPage = await getAvailableRecurringDueWork({
      page: 3,
      pageSize: 1,
    });
    expect(thirdPage.invoiceCandidates.map((candidate) => candidate.members[0]?.executionIdentityKey)).toEqual([
      'client_cadence_window:client:client-1:schedule:tenant-1:client_contract_line:assignment-1:client:advance:period:2025-03-01:2025-04-01:2025-03-01:2025-04-01',
    ]);
  });

  it('T011: due-work reader search by client name works for contract-cadence rows with no client billing-cycle record', async () => {
    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      searchTerm: 'zenith',
    });

    expect(result.total).toBe(1);
    expect(result.invoiceCandidates[0]).toMatchObject({
      clientName: 'Zenith Health',
      cadenceSources: ['contract_anniversary'],
    });
  });

  it('T012: due-work reader date filter operates on service-period-start dates for contract-cadence rows', async () => {
    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      dateRange: {
        from: '2025-05-01',
        to: '2025-05-31',
      },
    });

    expect(result.total).toBe(0);
    expect(result.invoiceCandidates).toEqual([]);
  });

  it('T117: client-arrears rows stay visible by service-period filter but remain blocked until the selected to-date reaches the invoice window start', async () => {
    const beforeWindowStarts = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      dateRange: {
        to: '2025-03-20',
      },
    });

    const blockedCandidate = beforeWindowStarts.invoiceCandidates.find(
      (candidate) => candidate.clientId === 'client-3',
    );

    expect(blockedCandidate).toMatchObject({
      servicePeriodStart: '2025-03-01',
      windowStart: '2025-04-01',
      canGenerate: false,
      blockedReason: 'One or more included obligations are not eligible for generation.',
    });

    const afterWindowStarts = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      dateRange: {
        to: '2025-04-05',
      },
    });

    const readyCandidate = afterWindowStarts.invoiceCandidates.find(
      (candidate) => candidate.clientId === 'client-3',
    );

    expect(readyCandidate).toMatchObject({
      servicePeriodStart: '2025-03-01',
      windowStart: '2025-04-01',
      canGenerate: true,
      blockedReason: null,
    });
  });

  it('T118: client-arrears materialization gaps align to the following invoice window instead of inventing a same-period repair gap', async () => {
    mocks.rowsByTable.client_billing_cycles = [
      {
        tenant: 'tenant-1',
        client_id: 'client-3',
        client_name: 'Wonder Co',
        billing_cycle_id: 'cycle-2025-03',
        billing_cycle: 'monthly',
        period_start_date: '2025-03-01',
        period_end_date: '2025-04-01',
        effective_date: '2025-03-01',
        invoice_id: null,
      },
      {
        tenant: 'tenant-1',
        client_id: 'client-3',
        client_name: 'Wonder Co',
        billing_cycle_id: 'cycle-2025-04',
        billing_cycle: 'monthly',
        period_start_date: '2025-04-01',
        period_end_date: '2025-05-01',
        effective_date: '2025-04-01',
        invoice_id: null,
      },
    ];

    mocks.rowsByTable.client_contracts = [
      {
        tenant: 'tenant-1',
        client_id: 'client-3',
        client_contract_line_id: 'assignment-3',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'arrears',
        start_date: '2025-03-01',
        end_date: null,
        is_active: true,
      },
    ];

    mocks.rowsByTable.recurring_service_periods = [];

    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
    });

    expect(result.invoiceCandidates).toEqual([]);
    expect(result.materializationGaps).toEqual([
      expect.objectContaining({
        clientId: 'client-3',
        scheduleKey: 'schedule:tenant-1:client_contract_line:assignment-3:client:arrears',
        periodKey: 'period:2025-03-01:2025-04-01',
        servicePeriodStart: '2025-03-01',
        servicePeriodEnd: '2025-04-01',
        invoiceWindowStart: '2025-04-01',
        invoiceWindowEnd: '2025-05-01',
      }),
    ]);
  });

  it('T003: due-work reader resolves client-cadence materialization gaps from surviving tables when `client_contract_lines` is absent', async () => {
    mocks.missingTables.add('client_contract_lines');

    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
    });

    expect(result.materializationGaps).toEqual([
      {
        executionIdentityKey:
          'client_cadence_window:client:client-2:schedule:tenant-1:client_contract_line:assignment-2:client:advance:period:2025-02-01:2025-03-01:2025-02-01:2025-03-01',
        selectionKey:
          'recurring-run-selection:client_cadence_window:client:client-2:schedule:tenant-1:client_contract_line:assignment-2:client:advance:period:2025-02-01:2025-03-01:2025-02-01:2025-03-01',
        clientId: 'client-2',
        clientName: 'Bravo Co',
        scheduleKey: 'schedule:tenant-1:client_contract_line:assignment-2:client:advance',
        periodKey: 'period:2025-02-01:2025-03-01',
        billingCycleId: 'cycle-2025-02',
        invoiceWindowStart: '2025-02-01',
        invoiceWindowEnd: '2025-03-01',
        servicePeriodStart: '2025-02-01',
        servicePeriodEnd: '2025-03-01',
        reason: 'missing_service_period_materialization',
        detail:
          'Recurring service periods were not materialized for this canonical client-cadence execution window.',
      },
    ]);
    expect(result.invoiceCandidates.map((candidate) => candidate.clientId)).not.toContain('client-2');
  });

  it('T106: due-work candidate grouping keeps one parent candidate per client + invoice window while surfacing financial split reasons', async () => {
    mocks.rowsByTable.recurring_service_periods = [
      {
        tenant: 'tenant-1',
        record_id: 'rsp-split-1',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: null,
        contract_id: 'contract-2',
        contract_name: 'Acme Monthly Support',
        contract_line_id: 'assignment-1',
        contract_line_name: 'Acme Retainer',
        client_contract_id: 'cc-1',
        currency_code: 'USD',
        tax_source: 'internal',
        export_shape_key: 'default-export',
      },
      {
        tenant: 'tenant-1',
        record_id: 'rsp-split-2',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-2:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: null,
        contract_id: 'contract-2',
        contract_name: 'Acme Monthly Support',
        contract_line_id: 'assignment-2',
        contract_line_name: 'Acme Backup',
        client_contract_id: 'cc-1',
        currency_code: 'EUR',
        tax_source: 'pending_external',
        export_shape_key: 'default-export',
      },
    ];

    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });

    expect(result.invoiceCandidates).toHaveLength(1);
    expect(result.invoiceCandidates[0]?.memberCount).toBe(2);
    expect(result.invoiceCandidates[0]?.splitReasons).toContain('financial_constraint');
  });

  it('T030: same-client no-PO recurring rows group into one parent candidate that remains combinable on PO scope', async () => {
    mocks.rowsByTable.recurring_service_periods = [
      {
        tenant: 'tenant-1',
        record_id: 'rsp-contract-scope-1',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: null,
        contract_id: 'contract-2',
        contract_name: 'Acme Monthly Support',
        contract_line_id: 'assignment-1',
        contract_line_name: 'Acme Retainer',
        client_contract_id: 'cc-1',
        po_required: false,
        currency_code: 'USD',
        tax_source: 'internal',
        export_shape_key: 'default-export',
      },
      {
        tenant: 'tenant-1',
        record_id: 'rsp-contract-scope-2',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-2:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: null,
        contract_id: 'contract-2',
        contract_name: 'Acme Monthly Support',
        contract_line_id: 'assignment-2',
        contract_line_name: 'Acme Backup',
        client_contract_id: 'cc-2',
        po_required: false,
        currency_code: 'USD',
        tax_source: 'internal',
        export_shape_key: 'default-export',
      },
    ];

    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });

    expect(result.invoiceCandidates).toHaveLength(1);
    expect(result.invoiceCandidates[0]?.memberCount).toBe(2);
    expect(result.invoiceCandidates[0]?.splitReasons).toContain('single_contract');
    expect(result.invoiceCandidates[0]?.splitReasons).not.toContain('purchase_order_scope');
  });

  it('T031: same-client rows with incompatible PO scopes remain grouped in one parent candidate but carry purchase-order split reasons', async () => {
    mocks.rowsByTable.recurring_service_periods = [
      {
        tenant: 'tenant-1',
        record_id: 'rsp-po-scope-1',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: null,
        contract_id: 'contract-2',
        contract_name: 'Acme Monthly Support',
        contract_line_id: 'assignment-1',
        contract_line_name: 'Acme Retainer',
        client_contract_id: 'cc-1',
        po_required: true,
        currency_code: 'USD',
        tax_source: 'internal',
        export_shape_key: 'default-export',
      },
      {
        tenant: 'tenant-1',
        record_id: 'rsp-po-scope-2',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-2:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: null,
        contract_id: 'contract-2',
        contract_name: 'Acme Monthly Support',
        contract_line_id: 'assignment-2',
        contract_line_name: 'Acme Backup',
        client_contract_id: 'cc-2',
        po_required: true,
        currency_code: 'USD',
        tax_source: 'internal',
        export_shape_key: 'default-export',
      },
    ];

    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });

    expect(result.invoiceCandidates).toHaveLength(1);
    expect(result.invoiceCandidates[0]?.memberCount).toBe(2);
    expect(result.invoiceCandidates[0]?.splitReasons).toContain('single_contract');
    expect(result.invoiceCandidates[0]?.splitReasons).toContain('purchase_order_scope');
  });

  it('T039: a client-cadence materialization gap only blocks the matching assignment candidate and does not block sibling assignment candidates in the same client window', async () => {
    mocks.rowsByTable.client_billing_cycles = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: 'cycle-2025-03',
        billing_cycle: 'monthly',
        period_start_date: '2025-03-01',
        period_end_date: '2025-04-01',
        effective_date: '2025-03-01',
        invoice_id: null,
      },
    ];

    mocks.rowsByTable.client_contracts = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_contract_line_id: 'assignment-line-ready',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        start_date: '2025-03-01',
        end_date: null,
        is_active: true,
      },
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_contract_line_id: 'assignment-line-gap',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        start_date: '2025-03-01',
        end_date: null,
        is_active: true,
      },
    ];

    mocks.rowsByTable.recurring_service_periods = [
      {
        tenant: 'tenant-1',
        record_id: 'rsp-ready',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-line-ready:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: 'cycle-2025-03',
        contract_id: 'contract-2',
        contract_name: 'Acme Monthly Support',
        contract_line_id: 'assignment-line-ready',
        contract_line_name: 'Acme Ready',
        client_contract_id: 'cc-ready',
        currency_code: 'USD',
        tax_source: 'internal',
        export_shape_key: 'default-export',
      },
    ];

    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });

    expect(result.materializationGaps).toEqual([
      expect.objectContaining({
        clientId: 'client-1',
        scheduleKey: 'schedule:tenant-1:client_contract_line:assignment-line-gap:client:advance',
        periodKey: 'period:2025-03-01:2025-04-01',
      }),
    ]);
    expect(result.invoiceCandidates).toHaveLength(1);
    expect(result.invoiceCandidates[0]).toMatchObject({
      canGenerate: true,
      blockedReason: null,
      memberCount: 1,
    });
    expect(result.invoiceCandidates[0]?.members[0]?.scheduleKey).toBe(
      'schedule:tenant-1:client_contract_line:assignment-line-ready:client:advance',
    );
  });

  it('T040: Date-valued billing cycle rows are normalized before client-cadence materialization gap sorting', async () => {
    mocks.rowsByTable.client_billing_cycles = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: 'cycle-2025-03',
        billing_cycle: 'monthly',
        period_start_date: new Date('2025-03-01T00:00:00.000Z'),
        period_end_date: new Date('2025-04-01T00:00:00.000Z'),
        effective_date: new Date('2025-03-01T00:00:00.000Z'),
        invoice_id: null,
      },
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: 'cycle-2025-02',
        billing_cycle: 'monthly',
        period_start_date: new Date('2025-02-01T00:00:00.000Z'),
        period_end_date: new Date('2025-03-01T00:00:00.000Z'),
        effective_date: new Date('2025-02-01T00:00:00.000Z'),
        invoice_id: null,
      },
    ];

    mocks.rowsByTable.client_contracts = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_contract_line_id: 'assignment-line-gap',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        start_date: '2025-02-01',
        end_date: null,
        is_active: true,
      },
    ];

    mocks.rowsByTable.recurring_service_periods = [];

    const result = await getAvailableRecurringDueWork({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });

    expect(result.materializationGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: 'client-1',
          billingCycleId: 'cycle-2025-03',
          servicePeriodStart: '2025-03-01',
          servicePeriodEnd: '2025-04-01',
          invoiceWindowStart: '2025-03-01',
          invoiceWindowEnd: '2025-04-01',
        }),
        expect.objectContaining({
          clientId: 'client-1',
          billingCycleId: 'cycle-2025-02',
          servicePeriodStart: '2025-02-01',
          servicePeriodEnd: '2025-03-01',
          invoiceWindowStart: '2025-02-01',
          invoiceWindowEnd: '2025-03-01',
        }),
      ]),
    );
  });
});
