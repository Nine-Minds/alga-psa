import { describe, expect, it } from 'vitest';

import {
  addContractLine,
  fetchDetailedContractLines,
} from 'server/src/lib/repositories/contractLineRepository';

type Row = Record<string, any>;
type RowSet = Record<string, Row[]>;

const normalizeKey = (key: string) => key.split('.').pop() ?? key;

class FakeQuery {
  private filters: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly state: {
      rows: RowSet;
      inserts: Array<{ table: string; payload: Row }>;
    },
  ) {}

  where(columnOrFilters: string | Record<string, unknown>, value?: unknown) {
    if (typeof columnOrFilters === 'string') {
      this.filters[normalizeKey(columnOrFilters)] = value;
      return this;
    }

    for (const [key, filterValue] of Object.entries(columnOrFilters)) {
      this.filters[normalizeKey(key)] = filterValue;
    }
    return this;
  }

  leftJoin() {
    return this;
  }

  select(_columns?: string[] | string) {
    return this;
  }

  orderBy() {
    return this;
  }

  first(_columns?: string[] | string) {
    return Promise.resolve(this.rows()[0] ?? null);
  }

  insert(payload: Row) {
    const inserted = { ...payload };
    const rows = this.state.rows[this.table] ?? [];
    rows.push(inserted);
    this.state.rows[this.table] = rows;
    this.state.inserts.push({ table: this.table, payload: inserted });
    return Promise.resolve([inserted]);
  }

  then(resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.rows()).then(resolve, reject);
  }

  private rows() {
    const rows = this.state.rows[this.table] ?? [];
    return rows.filter((row) =>
      Object.entries(this.filters).every(([key, value]) => row[normalizeKey(key)] === value),
    );
  }
}

function createFakeKnex(rows: RowSet) {
  const state = {
    rows: { ...rows },
    inserts: [] as Array<{ table: string; payload: Row }>,
  };

  const knex = ((table: string) => new FakeQuery(table, state)) as any;
  knex.fn = {
    now: () => 'now()',
  };

  return { knex, state };
}

describe('template line cadence_owner persistence', () => {
  it('T119: template-authored cadence_owner persists through template reads and live contract cloning', async () => {
    const { knex, state } = createFakeKnex({
      contract_templates: [
        {
          tenant: 'tenant-1',
          template_id: 'template-1',
        },
      ],
      'contract_template_lines as lines': [
        {
          tenant: 'tenant-1',
          template_id: 'template-1',
          template_line_id: 'template-line-1',
          display_order: 0,
          custom_rate: null,
          billing_timing: 'advance',
          cadence_owner: 'contract',
          created_at: '2026-03-17T00:00:00.000Z',
          template_line_name: 'Template Hourly Line',
          line_type: 'Hourly',
          billing_frequency: 'monthly',
          terms_billing_timing: null,
          default_rate: null,
          template_enable_proration: false,
          template_billing_cycle_alignment: 'start',
        },
      ],
      contract_template_lines: [
        {
          tenant: 'tenant-1',
          template_id: 'template-1',
          template_line_id: 'template-line-1',
          template_line_name: 'Template Hourly Line',
          description: null,
          billing_frequency: 'monthly',
          line_type: 'Hourly',
          service_category: null,
          is_active: true,
          enable_overtime: false,
          overtime_rate: null,
          overtime_threshold: null,
          enable_after_hours_rate: false,
          after_hours_multiplier: null,
          minimum_billable_time: null,
          round_up_to_nearest: null,
          custom_rate: null,
          display_order: 0,
          billing_timing: 'advance',
          cadence_owner: 'contract',
          created_at: '2026-03-17T00:00:00.000Z',
        },
      ],
      contract_template_line_fixed_config: [],
      contract_template_line_terms: [],
      contract_template_line_services: [],
      contract_lines: [],
    });

    const templateLines = await fetchDetailedContractLines(knex, 'tenant-1', 'template-1');
    expect(templateLines[0]?.cadence_owner).toBe('contract');

    const cloned = await addContractLine(knex, 'tenant-1', 'contract-live-1', 'template-line-1');
    expect(cloned.cadence_owner).toBe('contract');

    expect(state.inserts).toContainEqual({
      table: 'contract_lines',
      payload: expect.objectContaining({
        contract_id: 'contract-live-1',
        contract_line_id: expect.any(String),
        cadence_owner: 'contract',
        billing_timing: 'advance',
      }),
    });
  });
});
