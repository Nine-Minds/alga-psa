import { describe, expect, it } from 'vitest';
import { ensureClientBillingSettingsRow } from '../billingClients/billingSettings';
import { ensureDefaultContractForClientIfBillingConfigured } from '../billingClients/defaultContract';

type Row = Record<string, any>;
type TableState = Record<string, Row[]>;
type FakeKnexOptions = {
  forceEmptyDefaultContractLookups?: number;
};

class FakeQueryBuilder {
  private readonly state: TableState;
  private readonly tableName: string;
  private readonly options: FakeKnexOptions;
  private filters: Record<string, any>[] = [];
  private selectedColumns: string[] | null = null;
  private firstOnly = false;

  constructor(state: TableState, tableName: string, options: FakeKnexOptions) {
    this.state = state;
    this.tableName = tableName;
    this.options = options;
  }

  where(criteria: Record<string, any>): this {
    this.filters.push(criteria);
    return this;
  }

  select(...columns: string[]): this {
    this.selectedColumns = columns;
    return this;
  }

  first(...columns: string[]): this {
    if (columns.length > 0) {
      this.selectedColumns = columns;
    }
    this.firstOnly = true;
    return this;
  }

  async insert(payload: Row): Promise<{ returning: (columns: string | string[]) => Promise<Row[]> }> {
    const table = this.state[this.tableName] ?? (this.state[this.tableName] = []);

    if (
      this.tableName === 'contracts' &&
      payload.is_system_managed_default === true &&
      payload.owner_client_id
    ) {
      const duplicate = table.find(
        (row) =>
          row.tenant === payload.tenant &&
          row.owner_client_id === payload.owner_client_id &&
          row.is_system_managed_default === true
      );
      if (duplicate) {
        const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        });
        throw duplicateError;
      }
    }

    const row = { ...payload };
    table.push(row);
    return {
      returning: async (columns: string | string[]) => {
        const selected = Array.isArray(columns) ? columns : [columns];
        if (selected.includes('*')) {
          return [{ ...row }];
        }
        return [selected.reduce((acc, key) => ({ ...acc, [key]: row[key] }), {})];
      },
    };
  }

  async update(patch: Row): Promise<number> {
    const table = this.state[this.tableName] ?? [];
    const rows = this.filterRows(table);
    for (const row of rows) {
      Object.assign(row, patch);
    }
    return rows.length;
  }

  async del(): Promise<number> {
    const table = this.state[this.tableName] ?? [];
    const matching = this.filterRows(table);
    this.state[this.tableName] = table.filter((row) => !matching.includes(row));
    return matching.length;
  }

  then(resolve: (value: any) => any, reject?: (reason: any) => any): Promise<any> {
    if (this.firstOnly) {
      const firstRow = this.getRows()[0];
      return Promise.resolve(firstRow).then(resolve, reject);
    }
    return Promise.resolve(this.getRows()).then(resolve, reject);
  }

  private getRows(): Row[] {
    const table = this.state[this.tableName] ?? [];

    if (
      this.tableName === 'contracts' &&
      this.options.forceEmptyDefaultContractLookups &&
      this.options.forceEmptyDefaultContractLookups > 0 &&
      this.filters.some((criteria) => criteria.is_system_managed_default === true)
    ) {
      this.options.forceEmptyDefaultContractLookups -= 1;
      return [];
    }

    const rows = this.filterRows(table);
    return rows.map((row) => this.projectRow(row));
  }

  private filterRows(rows: Row[]): Row[] {
    if (this.filters.length === 0) {
      return [...rows];
    }
    return rows.filter((row) =>
      this.filters.every((criteria) =>
        Object.entries(criteria).every(([key, value]) => row[key] === value)
      )
    );
  }

  private projectRow(row: Row): Row {
    if (!this.selectedColumns || this.selectedColumns.length === 0 || this.selectedColumns.includes('*')) {
      return { ...row };
    }
    return this.selectedColumns.reduce((acc, key) => ({ ...acc, [key]: row[key] }), {});
  }
}

const createFakeKnex = (initialState: TableState, options: FakeKnexOptions = {}) => {
  const state: TableState = Object.fromEntries(
    Object.entries(initialState).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
  );

  const knex = ((tableName: string) => new FakeQueryBuilder(state, tableName, options)) as any;
  knex.fn = {
    now: () => '2026-03-21T00:00:00.000Z',
  };
  knex.transaction = async (handler: (trx: any) => Promise<any>) => handler(knex);
  knex.__state = state;
  return knex;
};

describe('default contract ensure on billing settings ensure', () => {
  it('T001: creates exactly one system-managed default contract and assignment and stays idempotent on repeated ensure', async () => {
    const knex = createFakeKnex({
      clients: [
        {
          tenant: 'tenant-1',
          client_id: 'client-1',
          default_currency_code: 'usd',
        },
      ],
      default_billing_settings: [
        {
          tenant: 'tenant-1',
          zero_dollar_invoice_handling: 'normal',
          suppress_zero_dollar_invoices: false,
          credit_expiration_days: 365,
          credit_expiration_notification_days: [30, 7, 1],
          enable_credit_expiration: true,
        },
      ],
      client_billing_settings: [],
      contracts: [],
      client_contracts: [],
    });

    const first = await ensureClientBillingSettingsRow(knex, {
      tenant: 'tenant-1',
      clientId: 'client-1',
    });
    const second = await ensureClientBillingSettingsRow(knex, {
      tenant: 'tenant-1',
      clientId: 'client-1',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const state = knex.__state as TableState;
    expect(state.client_billing_settings).toHaveLength(1);

    const defaultContracts = state.contracts.filter(
      (row) => row.tenant === 'tenant-1' && row.owner_client_id === 'client-1' && row.is_system_managed_default === true
    );
    expect(defaultContracts).toHaveLength(1);
    expect(defaultContracts[0]).toMatchObject({
      contract_name: 'System-managed default contract',
      status: 'active',
      is_active: true,
      is_template: false,
      currency_code: 'USD',
    });

    const contractId = defaultContracts[0].contract_id;
    const assignments = state.client_contracts.filter(
      (row) =>
        row.tenant === 'tenant-1' &&
        row.client_id === 'client-1' &&
        row.contract_id === contractId
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0].is_active).toBe(true);
  });

  it('T002: parallel ensure calls for the same tenant+client do not create duplicate default contracts', async () => {
    const knex = createFakeKnex(
      {
        clients: [
          {
            tenant: 'tenant-1',
            client_id: 'client-1',
            default_currency_code: 'USD',
          },
        ],
        default_billing_settings: [
          {
            tenant: 'tenant-1',
            zero_dollar_invoice_handling: 'normal',
            suppress_zero_dollar_invoices: false,
            credit_expiration_days: 365,
            credit_expiration_notification_days: [30, 7, 1],
            enable_credit_expiration: true,
          },
        ],
        client_billing_settings: [],
        contracts: [],
        client_contracts: [],
      },
      {
        // Force both parallel calls to miss the initial lookup, so both attempt insert.
        // The second insert must be rejected/retried via unique-violation path.
        forceEmptyDefaultContractLookups: 2,
      }
    );

    await Promise.all([
      ensureClientBillingSettingsRow(knex, { tenant: 'tenant-1', clientId: 'client-1' }),
      ensureClientBillingSettingsRow(knex, { tenant: 'tenant-1', clientId: 'client-1' }),
    ]);

    const state = knex.__state as TableState;
    const defaultContracts = state.contracts.filter(
      (row) => row.tenant === 'tenant-1' && row.owner_client_id === 'client-1' && row.is_system_managed_default === true
    );
    expect(defaultContracts).toHaveLength(1);
  });

  it('fallback ensure hook is a no-op when billing settings do not exist for the client', async () => {
    const knex = createFakeKnex({
      clients: [{ tenant: 'tenant-1', client_id: 'client-1', default_currency_code: 'USD' }],
      default_billing_settings: [],
      client_billing_settings: [],
      contracts: [],
      client_contracts: [],
    });

    const result = await ensureDefaultContractForClientIfBillingConfigured(knex, {
      tenant: 'tenant-1',
      clientId: 'client-1',
    });

    expect(result.ensured).toBe(false);
    const state = knex.__state as TableState;
    expect(state.contracts).toHaveLength(0);
  });

  it('fallback ensure hook provisions the default contract when billing settings already exist', async () => {
    const knex = createFakeKnex({
      clients: [{ tenant: 'tenant-1', client_id: 'client-1', default_currency_code: 'USD' }],
      default_billing_settings: [],
      client_billing_settings: [{ tenant: 'tenant-1', client_id: 'client-1' }],
      contracts: [],
      client_contracts: [],
    });

    const result = await ensureDefaultContractForClientIfBillingConfigured(knex, {
      tenant: 'tenant-1',
      clientId: 'client-1',
    });

    expect(result.ensured).toBe(true);
    const state = knex.__state as TableState;
    expect(state.contracts.filter((row) => row.is_system_managed_default === true)).toHaveLength(1);
    expect(state.client_contracts).toHaveLength(1);
  });

  it('normalizes legacy system-managed default contract naming to canonical convention during ensure', async () => {
    const knex = createFakeKnex({
      clients: [{ tenant: 'tenant-1', client_id: 'client-1', default_currency_code: 'USD' }],
      default_billing_settings: [],
      client_billing_settings: [{ tenant: 'tenant-1', client_id: 'client-1' }],
      contracts: [
        {
          tenant: 'tenant-1',
          contract_id: 'contract-legacy',
          owner_client_id: 'client-1',
          is_system_managed_default: true,
          is_template: false,
          contract_name: 'Default contract',
          contract_description: 'legacy description',
        },
      ],
      client_contracts: [],
    });

    const result = await ensureDefaultContractForClientIfBillingConfigured(knex, {
      tenant: 'tenant-1',
      clientId: 'client-1',
    });

    expect(result.ensured).toBe(true);
    const state = knex.__state as TableState;
    const contract = state.contracts.find((row) => row.contract_id === 'contract-legacy');
    expect(contract).toBeDefined();
    expect(contract?.contract_name).toBe('System-managed default contract');
    expect(contract?.contract_description).toBe('Created automatically for uncontracted work');
    expect(state.client_contracts).toHaveLength(1);
  });
});
