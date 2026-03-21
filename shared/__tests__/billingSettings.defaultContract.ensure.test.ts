import { describe, expect, it } from 'vitest';
import { ensureClientBillingSettingsRow } from '../billingClients/billingSettings';

type Row = Record<string, any>;
type TableState = Record<string, Row[]>;

class FakeQueryBuilder {
  private readonly state: TableState;
  private readonly tableName: string;
  private filters: Record<string, any>[] = [];
  private selectedColumns: string[] | null = null;
  private firstOnly = false;

  constructor(state: TableState, tableName: string) {
    this.state = state;
    this.tableName = tableName;
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

const createFakeKnex = (initialState: TableState) => {
  const state: TableState = Object.fromEntries(
    Object.entries(initialState).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
  );

  const knex = ((tableName: string) => new FakeQueryBuilder(state, tableName)) as any;
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
});
