import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  fetchDetailedContractLines,
  updateContractLine,
} from 'server/src/lib/repositories/contractLineRepository';

type QueryState = {
  rows: Record<string, any[]>;
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
};

class FakeQuery {
  constructor(
    private readonly table: string,
    private readonly state: QueryState,
  ) {}

  where(_filters: Record<string, unknown>) {
    return this;
  }

  leftJoin() {
    return this;
  }

  select(_columns: string[]) {
    return this;
  }

  orderBy() {
    return Promise.resolve(this.rows());
  }

  first(_columns?: string | string[]) {
    return Promise.resolve(this.rows()[0]);
  }

  update(payload: Record<string, unknown>) {
    this.state.updates.push({ table: this.table, payload });
    return Promise.resolve(1);
  }

  private rows() {
    return this.state.rows[this.table] ?? [];
  }
}

function createFakeKnex(rows: QueryState['rows']) {
  const state: QueryState = {
    rows,
    updates: [],
  };

  const knex = ((table: string) => new FakeQuery(table, state)) as any;
  knex.fn = {
    now: () => 'now()',
  };

  return {
    knex,
    updates: state.updates,
  };
}

type MigrationContractLineRow = {
  contract_line_id: string;
  cadence_owner?: 'client' | 'contract' | null;
};

function createMigrationKnex(rows: MigrationContractLineRow[], hasCadenceOwnerColumn = false) {
  const state = {
    rows: rows.map((row) => ({ ...row })),
    addedCadenceOwnerColumn: false,
    rawCalls: [] as string[],
  };

  const knex = ((table: string) => {
    if (table !== 'contract_lines') {
      throw new Error(`Unexpected table access in migration test: ${table}`);
    }

    return {
      whereNull(column: string) {
        return {
          async update(payload: Record<string, unknown>) {
            let updates = 0;
            for (const row of state.rows) {
              if ((row as Record<string, unknown>)[column] == null) {
                Object.assign(row, payload);
                updates += 1;
              }
            }
            return updates;
          },
        };
      },
    };
  }) as any;

  knex.schema = {
    hasTable: vi.fn(async (table: string) => table === 'contract_lines'),
    hasColumn: vi.fn(async (table: string, column: string) =>
      table === 'contract_lines' && column === 'cadence_owner' ? hasCadenceOwnerColumn : false,
    ),
    alterTable: vi.fn(async (_table: string, callback: (table: any) => void) => {
      const tableApi = {
        string: vi.fn(() => ({
          notNullable: vi.fn(() => ({
            defaultTo: vi.fn(() => {
              state.addedCadenceOwnerColumn = true;
            }),
          })),
        })),
        dropColumn: vi.fn(),
      };
      callback(tableApi);
    }),
  };

  knex.raw = vi.fn(async (sql: string) => {
    state.rawCalls.push(sql);
  });

  return { knex, state };
}

describe('contract line cadence owner persistence', () => {
  it('T101: plan artifacts and migration make contract_lines the v1 cadence_owner persistence location', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const prd = fs.readFileSync(
      path.join(
        repoRoot,
        'ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PRD.md',
      ),
      'utf8',
    );
    const migration = fs.readFileSync(
      path.join(
        repoRoot,
        'server/migrations/20260317170000_add_cadence_owner_to_contract_lines.cjs',
      ),
      'utf8',
    );

    expect(prd).toContain('`cadence_owner` must live on `contract_lines` for v1');
    expect(migration).toContain("table.string('cadence_owner', 16).notNullable().defaultTo('client')");
    expect(migration).toContain("CHECK (cadence_owner IN ('client', 'contract'))");
  });

  it('T102 and T104: repository readers default missing cadence_owner to client and preserve persisted values on update', async () => {
    const reader = createFakeKnex({
      contract_templates: [],
      'contract_lines as cl': [
        {
          tenant: 'tenant-1',
          contract_id: 'contract-1',
          contract_line_id: 'line-legacy',
          display_order: 0,
          custom_rate: null,
          billing_timing: 'arrears',
          contract_line_name: 'Legacy line',
          contract_line_type: 'Fixed',
          billing_frequency: 'monthly',
          enable_proration: false,
          billing_cycle_alignment: 'start',
          created_at: '2026-03-17T00:00:00.000Z',
        },
        {
          tenant: 'tenant-1',
          contract_id: 'contract-1',
          contract_line_id: 'line-contract',
          display_order: 1,
          custom_rate: null,
          billing_timing: 'advance',
          cadence_owner: 'contract',
          contract_line_name: 'Contract cadence line',
          contract_line_type: 'Fixed',
          billing_frequency: 'monthly',
          enable_proration: false,
          billing_cycle_alignment: 'start',
          created_at: '2026-03-17T00:00:00.000Z',
        },
      ],
    });

    const lines = await fetchDetailedContractLines(reader.knex, 'tenant-1', 'contract-1');

    expect(lines.map((line) => line.cadence_owner)).toEqual(['client', 'contract']);

    const writer = createFakeKnex({
      contract_templates: [],
      contract_lines: [
        {
          tenant: 'tenant-1',
          contract_id: 'contract-1',
          contract_line_id: 'line-1',
          display_order: 2,
          custom_rate: null,
          billing_timing: 'advance',
          cadence_owner: 'contract',
          created_at: '2026-03-17T00:00:00.000Z',
        },
      ],
    });

    const updated = await updateContractLine(
      writer.knex,
      'tenant-1',
      'contract-1',
      'line-1',
      {
        billing_timing: 'advance',
        cadence_owner: 'contract',
      },
    );

    expect(writer.updates).toHaveLength(1);
    expect(writer.updates[0]).toEqual({
      table: 'contract_lines',
      payload: {
        custom_rate: null,
        display_order: undefined,
        billing_timing: 'advance',
        cadence_owner: 'contract',
        updated_at: 'now()',
      },
    });
    expect(updated.cadence_owner).toBe('contract');
  });

  it('T155 and T156: cadence_owner migration backfills legacy nulls to client without mutating existing cadence values', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const migrationModule = await import(
      pathToFileURL(
        path.join(
          repoRoot,
          'server/migrations/20260317170000_add_cadence_owner_to_contract_lines.cjs',
        ),
      ).href
    );
    const { knex, state } = createMigrationKnex([
      { contract_line_id: 'line-null', cadence_owner: null },
      { contract_line_id: 'line-client', cadence_owner: 'client' },
      { contract_line_id: 'line-contract', cadence_owner: 'contract' },
    ]);

    await migrationModule.up(knex);

    expect(state.addedCadenceOwnerColumn).toBe(true);
    expect(state.rows).toEqual([
      { contract_line_id: 'line-null', cadence_owner: 'client' },
      { contract_line_id: 'line-client', cadence_owner: 'client' },
      { contract_line_id: 'line-contract', cadence_owner: 'contract' },
    ]);
    expect(
      state.rawCalls.some((sql) => sql.includes('contract_lines_cadence_owner_check')),
    ).toBe(true);
  });

  it('T110: cadence_owner backfill stays scoped to contract_lines and does not mutate invoice-backed outputs', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const migrationPath = path.join(
      repoRoot,
      'server/migrations/20260317170000_add_cadence_owner_to_contract_lines.cjs',
    );
    const migrationSource = fs.readFileSync(migrationPath, 'utf8');
    const migrationModule = await import(pathToFileURL(migrationPath).href);
    const { knex, state } = createMigrationKnex([
      { contract_line_id: 'line-null', cadence_owner: null },
      { contract_line_id: 'line-client', cadence_owner: 'client' },
    ]);

    await migrationModule.up(knex);

    expect(migrationSource).not.toMatch(/invoice_charge_details|invoice_charges|invoices/);
    expect(state.rows).toEqual([
      { contract_line_id: 'line-null', cadence_owner: 'client' },
      { contract_line_id: 'line-client', cadence_owner: 'client' },
    ]);
    expect(state.rawCalls.every((sql) => !/invoice_charge_details|invoice_charges|invoices/.test(sql))).toBe(true);
  });
});
