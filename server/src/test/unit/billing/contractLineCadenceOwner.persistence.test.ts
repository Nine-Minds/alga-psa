import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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
});
