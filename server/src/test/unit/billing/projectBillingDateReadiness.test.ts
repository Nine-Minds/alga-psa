import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & {
  schedule_entry_id: string;
  trigger_type: string;
  trigger_date: string | null;
  status: string;
};

const state = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: vi.fn(() => {
      let selected = [...state.rows];
      let updates: Record<string, unknown> = {};
      const query = {
        where(condition: Record<string, unknown> | string, operator?: string, value?: unknown) {
          if (typeof condition === 'string') {
            if (operator === '<=') {
              selected = selected.filter((row) => String(row[condition]) <= String(value));
            }
          } else {
            selected = selected.filter((row) => (
              Object.entries(condition).every(([key, expected]) => row[key] === expected)
            ));
          }
          return query;
        },
        whereNotNull(column: string) {
          selected = selected.filter((row) => row[column] !== null && row[column] !== undefined);
          return query;
        },
        update(values: Record<string, unknown>) {
          updates = values;
          return query;
        },
        returning() {
          return Promise.resolve(selected.map((row) => ({ ...row, ...updates })));
        },
      };
      return query;
    }),
  })),
}));

vi.mock('@alga-psa/billing/models/projectBillingModelUtils', () => ({
  resolveProjectBillingDb: vi.fn(async () => ({ connection: {}, tenant: 'tenant-1' })),
  normalizeProjectBillingScheduleEntry: vi.fn((row: Row) => row),
}));

import { evaluateDateReadiness } from '@alga-psa/billing/services/projectBillingService';

const row = (
  schedule_entry_id: string,
  trigger_date: string | null,
  status = 'pending',
  trigger_type = 'date',
): Row => ({
  schedule_entry_id,
  tenant: 'tenant-1',
  config_id: 'config-1',
  entry_type: 'milestone',
  description: schedule_entry_id,
  amount: 100,
  percentage: null,
  trigger_type,
  phase_id: null,
  trigger_date,
  status,
  invoice_id: null,
  invoice_charge_id: null,
  ready_at: null,
  approved_at: null,
  approved_by: null,
  invoiced_at: null,
  display_order: 0,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
});

describe('date-triggered project billing readiness (T009)', () => {
  beforeEach(() => {
    state.rows = [
      row('past', '2026-07-14'),
      row('boundary', '2026-07-15'),
      row('future', '2026-07-16'),
      row('already-ready', '2026-07-14', 'ready'),
      row('manual', null, 'pending', 'manual'),
    ];
  });

  it('flips pending date entries through the evaluated UTC date, including the boundary', async () => {
    const result = await evaluateDateReadiness(new Date('2026-07-15T23:59:59.000Z'));

    expect(result.map((entry) => entry.schedule_entry_id)).toEqual(['past', 'boundary']);
    expect(result.every((entry) => entry.status === 'ready')).toBe(true);
    expect(result.every((entry) => entry.ready_at === '2026-07-15T23:59:59.000Z')).toBe(true);
  });

  it('does not flip an entry before its trigger date', async () => {
    const result = await evaluateDateReadiness('2026-07-13T12:00:00.000Z');
    expect(result).toEqual([]);
  });

  it('rejects invalid evaluation dates before opening a database query', async () => {
    await expect(evaluateDateReadiness('not-a-date')).rejects.toThrow('now must be a valid date');
  });
});
