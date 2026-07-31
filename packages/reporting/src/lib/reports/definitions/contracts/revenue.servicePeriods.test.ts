import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./revenue.ts', import.meta.url), 'utf8');

describe('contract revenue report definition service-period wiring', () => {
  it('uses canonical recurring service periods for YTD billing with invoice-date fallback', () => {
    expect(source).toContain("description: 'Overview of monthly recurring revenue and year-to-date billed service periods by contract'");
    expect(source).toContain("table: 'raw_sql'");
    expect(source).toContain('COALESCE(MAX(iid.service_period_end)::timestamp, MAX(inv.invoice_date)::timestamp) AS reporting_period_end');
    expect(source).toContain('COUNT(iid.item_detail_id) FILTER (WHERE iid.item_detail_id IS NOT NULL) = 0');
    expect(source).toContain('COALESCE(SUM(iifd.allocated_amount), 0)');
    expect(source).toContain('contract_revenue_facts.reporting_period_end >= {{start_of_year}}');
    expect(source).toContain('contract_revenue_facts.reporting_period_end < {{end_of_year}}');
  });

  it('uses tenant-table placeholders instead of hand-coded raw SQL tenant predicates', () => {
    expect(source).toContain('{{tenant_table:invoice_charges AS ic}}');
    expect(source).toContain('{{tenant_table:invoices AS inv}}');
    expect(source).toContain('{{tenant_table:invoice_charge_details AS iid}}');
    expect(source).toContain('{{tenant_table:invoice_charge_fixed_details AS iifd}}');

    expect(source).not.toContain('WHERE ic.tenant = {{tenant}}');
    expect(source).not.toContain('inv.tenant = ic.tenant');
    expect(source).not.toContain('iid.tenant = ic.tenant');
    expect(source).not.toContain('iifd.tenant = iid.tenant');
  });
});
