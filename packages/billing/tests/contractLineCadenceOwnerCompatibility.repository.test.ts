import { describe, expect, it } from 'vitest';

import {
  fetchContractLineById,
  fetchContractLineMappings,
  fetchDetailedContractLines,
  updateContractLine,
} from '../src/repositories/contractLineRepository';

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

  select(_columns: string[] | string) {
    return this;
  }

  orderBy() {
    return this;
  }

  first(_columns?: string | string[]) {
    return Promise.resolve(this.rows()[0]);
  }

  update(payload: Record<string, unknown>) {
    this.state.updates.push({ table: this.table, payload });
    return Promise.resolve(1);
  }

  then(resolve: (value: any[]) => unknown) {
    return Promise.resolve(this.rows()).then(resolve);
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

describe('contract line cadence_owner repository compatibility', () => {
  it('T108: repository readers and writer results default missing cadence_owner to client for legacy live rows', async () => {
    const { knex, updates } = createFakeKnex({
      contract_templates: [],
      contract_lines: [
        {
          tenant: 'tenant-1',
          contract_id: 'contract-1',
          contract_line_id: 'line-1',
          display_order: 0,
          custom_rate: null,
          billing_timing: 'arrears',
          cadence_owner: null,
          created_at: '2026-03-17T00:00:00.000Z',
        },
      ],
      'contract_lines as cl': [
        {
          tenant: 'tenant-1',
          contract_id: 'contract-1',
          contract_line_id: 'line-1',
          display_order: 0,
          custom_rate: null,
          billing_timing: 'arrears',
          cadence_owner: null,
          created_at: '2026-03-17T00:00:00.000Z',
          contract_line_name: 'Legacy line',
          contract_line_type: 'Fixed',
          billing_frequency: 'monthly',
          enable_proration: false,
          billing_cycle_alignment: 'start',
        },
      ],
    });

    const mappings = await fetchContractLineMappings(knex, 'tenant-1', 'contract-1');
    const detailed = await fetchDetailedContractLines(knex, 'tenant-1', 'contract-1');
    const line = await fetchContractLineById(knex, 'tenant-1', 'line-1');
    const updated = await updateContractLine(knex, 'tenant-1', 'contract-1', 'line-1', {
      custom_rate: 125,
    });

    expect(mappings[0]?.cadence_owner).toBe('client');
    expect(detailed[0]?.cadence_owner).toBe('client');
    expect(line?.cadence_owner).toBe('client');
    expect(updated.cadence_owner).toBe('client');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      table: 'contract_lines',
      payload: {
        custom_rate: 125,
        display_order: undefined,
        billing_timing: undefined,
        cadence_owner: 'client',
        updated_at: 'now()',
      },
    });
  });
});
