import { describe, expect, it } from 'vitest';

import ContractLineFixedConfig from '../src/models/contractLineFixedConfig';

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

  return {
    knex,
    updates: state.updates,
  };
}

describe('billing_cycle_alignment compatibility model behavior', () => {
  it('T109: fixed config reads and writes keep billing_cycle_alignment readable while no longer requiring it for new writes', async () => {
    const { knex, updates } = createFakeKnex({
      contract_lines: [
        {
          contract_line_id: 'line-1',
          custom_rate: 100,
          enable_proration: true,
          billing_cycle_alignment: null,
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-17T00:00:00.000Z',
        },
      ],
    });

    const model = new ContractLineFixedConfig(knex, 'tenant-1');
    const config = await model.getByPlanId('line-1');

    expect(config?.billing_cycle_alignment).toBe('prorated');

    await model.update('line-1', {
      enable_proration: true,
    });

    expect(updates.at(-1)).toEqual({
      table: 'contract_lines',
      payload: expect.objectContaining({
        enable_proration: true,
        billing_cycle_alignment: 'prorated',
      }),
    });
  });
});
