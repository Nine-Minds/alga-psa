import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

type Row = Record<string, any>;

function normalizeTableName(tableName: string): string {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function normalizeColumn(column: string): string {
  return column.replace(/^.*\./, '').replace(/\s+as\s+.*$/i, '').trim();
}

function createQueryBuilder(
  tableName: string,
  rowsByTable: Record<string, Row[]>,
  raw: (sql: string) => string,
) {
  let resultRows = [...(rowsByTable[tableName] ?? [])];
  let firstRowOnly = false;

  const applyEqualityFilter = (column: string, expected: any) => {
    resultRows = resultRows.filter((row) => row[normalizeColumn(column)] === expected);
  };

  const builder: any = {
    where: vi.fn((columnOrCriteria: string | Record<string, any> | ((builder: any) => unknown), operatorOrValue?: any, value?: any) => {
      if (typeof columnOrCriteria === 'function') {
        columnOrCriteria(builder);
        return builder;
      }

      if (typeof columnOrCriteria === 'object') {
        resultRows = resultRows.filter((row) =>
          Object.entries(columnOrCriteria).every(([column, expected]) =>
            row[normalizeColumn(column)] === expected,
          ),
        );
        return builder;
      }

      const operator = value === undefined ? '=' : operatorOrValue;
      const expectedValue = value === undefined ? operatorOrValue : value;
      if (operator === '=') {
        applyEqualityFilter(columnOrCriteria, expectedValue);
        return builder;
      }

      return builder;
    }),
    andWhere: vi.fn((...args: any[]) => builder.where(...args)),
    orWhere: vi.fn(() => builder),
    whereNull: vi.fn((column: string) => {
      const normalizedColumn = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalizedColumn] == null);
      return builder;
    }),
    whereIn: vi.fn((column: string, expectedValues: any[]) => {
      const normalizedColumn = normalizeColumn(column);
      resultRows = resultRows.filter((row) => expectedValues.includes(row[normalizedColumn]));
      return builder;
    }),
    whereNotIn: vi.fn((column: string, excludedValues: any[]) => {
      const normalizedColumn = normalizeColumn(column);
      resultRows = resultRows.filter((row) => !excludedValues.includes(row[normalizedColumn]));
      return builder;
    }),
    whereNotNull: vi.fn((column: string) => {
      resultRows = resultRows.filter((row) => {
        const value = row[normalizeColumn(column)];
        return value !== null && value !== undefined;
      });
      return builder;
    }),
    select: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    groupBy: vi.fn(() => builder),
    max: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    first: vi.fn(() => {
      firstRowOnly = true;
      return builder;
    }),
    join: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    update: vi.fn(async (patch: Record<string, unknown>) => {
      for (const row of resultRows) {
        Object.assign(row, patch);
      }
      return resultRows.length;
    }),
    insert: vi.fn(async (rowsToInsert: Row[] | Row) => {
      const normalizedRows = Array.isArray(rowsToInsert) ? rowsToInsert : [rowsToInsert];
      rowsByTable[tableName] = [...(rowsByTable[tableName] ?? []), ...normalizedRows];
      resultRows = [...rowsByTable[tableName]];
      return normalizedRows.length;
    }),
    raw,
    then: (resolve: (value: Row[] | Row | undefined) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(firstRowOnly ? resultRows[0] : resultRows).then(resolve, reject),
  };

  return builder;
}

const mocks = vi.hoisted(() => {
  const rowsByTable: Record<string, Row[]> = {};
  const missingTables = new Set<string>();
  const raw = vi.fn((sql: string) => sql);
  const knex = vi.fn((tableName: string) => {
    const normalizedTableName = normalizeTableName(tableName);
    if (missingTables.has(normalizedTableName)) {
      throw new Error(`relation "${normalizedTableName}" does not exist`);
    }

    return createQueryBuilder(normalizedTableName, rowsByTable, raw);
  }) as any;
  knex.raw = raw;

  return {
    hasPermission: vi.fn(),
    rowsByTable,
    missingTables,
    createTenantKnex: vi.fn(async () => ({ knex })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
      callback(knex),
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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

const {
  getRecurringServicePeriodManagementView,
  listRecurringServicePeriodScheduleSummaries,
  previewRecurringServicePeriodInvoiceLinkageRepair,
  previewRecurringServicePeriodRegeneration,
  repairMissingRecurringServicePeriods,
} = await import('../../../../../packages/billing/src/actions/recurringServicePeriodActions');

describe('recurring service period actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.missingTables.clear();
    mocks.rowsByTable.recurring_service_periods = [
      {
        record_id: 'rsp-client-1',
        tenant: 'tenant-1',
        schedule_key: 'schedule:tenant-1:client_contract_line:line-1:client:arrears',
        period_key: 'period:2025-01-01:2025-02-01',
        revision: 1,
        obligation_id: 'line-1',
        obligation_type: 'client_contract_line',
        charge_family: 'fixed',
        cadence_owner: 'client',
        due_position: 'arrears',
        lifecycle_state: 'generated',
        service_period_start: '2025-01-01',
        service_period_end: '2025-02-01',
        invoice_window_start: '2025-02-01',
        invoice_window_end: '2025-03-01',
        activity_window_start: null,
        activity_window_end: null,
        timing_metadata: null,
        provenance_kind: 'system_generated',
        source_rule_version: 'line-1:v1',
        reason_code: 'materialization',
        source_run_key: 'materialize-1',
        supersedes_record_id: null,
        invoice_id: null,
        invoice_charge_id: null,
        invoice_charge_detail_id: null,
        invoice_linked_at: null,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    ];
    mocks.rowsByTable.contract_lines = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_name: 'Acme Corp',
        contract_id: 'contract-1',
        contract_name: 'Acme Managed Services',
        contract_line_id: 'line-1',
        contract_line_name: 'Managed Router',
        contract_line_type: 'fixed',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'arrears',
        assignment_start_date: '2025-01-01',
        assignment_end_date: null,
        is_system_managed_default: false,
      },
    ];
    mocks.rowsByTable.clients = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        billing_cycle: 'monthly',
      },
    ];
    mocks.rowsByTable.client_billing_settings = [];
    mocks.rowsByTable.client_billing_cycles = [];
    mocks.rowsByTable.invoices = [];
  });

  it('T076: service-period view actions require billing.recurring_service_periods.view', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    await expect(
      getRecurringServicePeriodManagementView('schedule:tenant-1:contract_line:line-1:contract:arrears'),
    ).resolves.toEqual({
      permissionError: 'Permission denied: Cannot view recurring service periods',
    });

    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'billing.recurring_service_periods',
      'view',
    );
  });

  it('T077: service-period regenerate actions require billing.recurring_service_periods.regenerate', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    await expect(
      previewRecurringServicePeriodRegeneration({
        existingRecords: [],
        candidateRecords: [],
        regeneratedAt: '2026-03-18T20:00:00.000Z',
        sourceRuleVersion: 'line-1:v2',
        sourceRunKey: 'regen-1',
      }),
    ).resolves.toEqual({
      permissionError: 'Permission denied: Cannot regenerate recurring service periods',
    });

    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'billing.recurring_service_periods',
      'regenerate',
    );
  });

  it('T078: service-period repair/history correction actions require billing.recurring_service_periods.correct_history', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    await expect(
      previewRecurringServicePeriodInvoiceLinkageRepair({
        record: buildRecurringServicePeriodRecord({
          lifecycleState: 'billed',
        }),
        invoiceLinkage: {
          invoiceId: 'invoice-1',
          invoiceChargeId: 'charge-1',
          invoiceChargeDetailId: 'detail-1',
          linkedAt: '2026-03-18T20:00:00.000Z',
        },
        repairedAt: '2026-03-18T20:00:00.000Z',
        sourceRuleVersion: 'repair:v1',
        sourceRunKey: 'repair-1',
      }),
    ).resolves.toEqual({
      permissionError: 'Permission denied: Cannot repair recurring service period history',
    });

    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'billing.recurring_service_periods',
      'correct_history',
    );
  });

  it('T079: service-period regeneration action surfaces conflict payloads when preserved edited or billed rows no longer match regenerated candidates', async () => {
    const editedOverride = buildRecurringServicePeriodRecord({
      recordId: 'rsp_override',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:contract:arrears',
      periodKey: 'period:2026-06-10:2026-07-10',
      lifecycleState: 'edited',
      servicePeriod: {
        start: '2026-06-12',
        end: '2026-07-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-06-12',
        end: '2026-07-10',
        semantics: 'half_open',
      },
      provenance: {
        kind: 'user_edited',
        reasonCode: 'boundary_adjustment',
        sourceRuleVersion: 'contract-line-1:v1',
        sourceRunKey: 'edit-1',
        supersedesRecordId: 'rsp_original',
      },
    });

    const billedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_billed',
      scheduleKey: editedOverride.scheduleKey,
      periodKey: 'period:2026-07-10:2026-08-10',
      lifecycleState: 'billed',
      servicePeriod: {
        start: '2026-07-10',
        end: '2026-08-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-07-10',
        end: '2026-08-10',
        semantics: 'half_open',
      },
    });

    const plan = await previewRecurringServicePeriodRegeneration({
      existingRecords: [editedOverride, billedRecord],
      candidateRecords: [
        buildRecurringServicePeriodRecord({
          recordId: 'rsp_candidate',
          scheduleKey: editedOverride.scheduleKey,
          periodKey: editedOverride.periodKey,
          servicePeriod: {
            start: '2026-06-10',
            end: '2026-07-10',
            semantics: 'half_open',
          },
          invoiceWindow: {
            start: '2026-06-10',
            end: '2026-07-10',
            semantics: 'half_open',
          },
        }),
      ],
      regeneratedAt: '2026-03-18T20:05:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'regen-2',
    });

    expect(plan).toMatchObject({
      preservedRecords: [editedOverride, billedRecord],
      conflicts: [
        {
          kind: 'service_period_mismatch',
          recordId: 'rsp_override',
        },
        {
          kind: 'missing_candidate',
          recordId: 'rsp_billed',
        },
      ],
    });
  });

  it('T008: management view resolves client-cadence obligation context without `client_contract_lines`', async () => {
    mocks.missingTables.add('client_contract_lines');

    const result = await getRecurringServicePeriodManagementView(
      'schedule:tenant-1:client_contract_line:line-1:client:arrears',
    );

    expect(result).toMatchObject({
      scheduleKey: 'schedule:tenant-1:client_contract_line:line-1:client:arrears',
      obligationId: 'line-1',
      obligationType: 'client_contract_line',
      clientId: 'client-1',
      clientName: 'Acme Corp',
      contractId: 'contract-1',
      contractName: 'Acme Managed Services',
      contractLineId: 'line-1',
      contractLineName: 'Managed Router',
      summary: {
        totalRows: 1,
        generatedRows: 1,
      },
    });
  });

  it('T304: zero-row schedule management loads a repairable state instead of crashing when the live obligation still exists', async () => {
    mocks.rowsByTable.recurring_service_periods = [];

    const result = await getRecurringServicePeriodManagementView(
      'schedule:tenant-1:client_contract_line:line-1:client:arrears',
    );

    expect(result).toEqual({
      scheduleKey: 'schedule:tenant-1:client_contract_line:line-1:client:arrears',
      obligationId: 'line-1',
      obligationType: 'client_contract_line',
      cadenceOwner: 'client',
      duePosition: 'arrears',
      chargeFamily: 'fixed',
      clientId: 'client-1',
      clientName: 'Acme Corp',
      contractId: 'contract-1',
      contractName: 'Acme Managed Services',
      contractLineId: 'line-1',
      contractLineName: 'Managed Router',
      status: 'repair_required',
      summary: {
        totalRows: 0,
        exceptionRows: 0,
        generatedRows: 0,
        editedRows: 0,
        skippedRows: 0,
        lockedRows: 0,
        billedRows: 0,
        supersededRows: 0,
        archivedRows: 0,
      },
      rows: [],
    });
  });

  it('T306: repairing a missing client-cadence schedule accepts date-only assignment boundaries and materializes future rows', async () => {
    mocks.rowsByTable.recurring_service_periods = [];
    mocks.rowsByTable.contract_lines = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_name: 'Acme Corp',
        contract_id: 'contract-1',
        contract_name: 'Acme Managed Services',
        contract_line_id: 'line-1',
        contract_line_name: 'Managed Router',
        contract_line_type: 'fixed',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        assignment_start_date: '2026-03-01',
        assignment_end_date: null,
        is_system_managed_default: false,
      },
    ];

    const result = await repairMissingRecurringServicePeriods(
      'schedule:tenant-1:client_contract_line:line-1:client:advance',
    );

    expect(result).toMatchObject({
      scheduleKey: 'schedule:tenant-1:client_contract_line:line-1:client:advance',
      backfilledRows: expect.any(Number),
      realignedRows: 0,
      supersededRows: 0,
    });
    expect((result as any).backfilledRows).toBeGreaterThan(0);
    expect(mocks.rowsByTable.recurring_service_periods).not.toEqual([]);
    expect(mocks.rowsByTable.recurring_service_periods[0]).toMatchObject({
      schedule_key: 'schedule:tenant-1:client_contract_line:line-1:client:advance',
      service_period_start: expect.stringMatching(/^2026-\d{2}-\d{2}$/),
      provenance_kind: 'generated',
      reason_code: 'backfill_materialization',
    });
  });

  it('filters orphaned recurring schedule summaries from deleted contracts', async () => {
    mocks.rowsByTable.recurring_service_periods = [
      {
        ...mocks.rowsByTable.recurring_service_periods[0],
        lifecycle_state: 'generated',
        client_name: 'Acme Corp',
        contract_name: 'Acme Managed Services',
        contract_line_name: 'Managed Router',
      },
      {
        ...mocks.rowsByTable.recurring_service_periods[0],
        record_id: 'rsp-orphan-1',
        schedule_key: 'schedule:tenant-1:contract_line:orphan-line:contract:arrears',
        obligation_id: 'orphan-line',
        lifecycle_state: 'generated',
        client_name: null,
        contract_name: null,
        contract_line_name: null,
      },
      {
        ...mocks.rowsByTable.recurring_service_periods[0],
        record_id: 'rsp-superseded-1',
        schedule_key: 'schedule:tenant-1:client_contract_line:line-1:client:advance',
        lifecycle_state: 'superseded',
        client_name: 'Acme Corp',
        contract_name: 'Acme Managed Services',
        contract_line_name: 'Managed Router',
      },
    ];

    await expect(listRecurringServicePeriodScheduleSummaries()).resolves.toEqual([
      expect.objectContaining({
        scheduleKey: 'schedule:tenant-1:client_contract_line:line-1:client:arrears',
        clientName: 'Acme Corp',
        contractName: 'Acme Managed Services',
        contractLineName: 'Managed Router',
      }),
    ]);
  });
});
