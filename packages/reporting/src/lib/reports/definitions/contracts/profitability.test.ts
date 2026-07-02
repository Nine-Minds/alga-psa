import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./profitability.ts', import.meta.url), 'utf8');

describe('contract profitability report definition pricing and fan-out safety', () => {
  it('uses the $50/hr minute-rate conversion (83.33 cents/min)', () => {
    expect(source).toContain("COALESCE(time_entries.billable_duration * 83.33, 0)");
    expect(source).not.toContain('833.33');
  });

  it('does not join invoices to users when computing gross profit or margins', () => {
    expect(source).not.toContain("{ left: 'invoices.client_id', right: 'time_entries.user_id' }");
  });

  it('uses separate raw_sql aggregate queries for gross profit, margin percentage, and average margin', () => {
    expect(source).toContain("table: 'raw_sql'");
    expect(source).toContain('COALESCE(revenue.total_revenue, 0) - COALESCE(cost.total_cost, 0) AS sum');
    expect(source).toContain('WITH invoice_totals AS (');
  });
});
