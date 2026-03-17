import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/services/accountingExportInvoiceSelector.ts', import.meta.url),
  'utf8'
);

describe('accountingExportInvoiceSelector service-period wiring', () => {
  it('prefers invoice charge detail service periods over invoice header billing periods', () => {
    expect(source).toContain(".leftJoin('invoice_charge_details as iid'");
    expect(source).toContain("'iid.service_period_start as detail_service_period_start'");
    expect(source).toContain("'iid.service_period_end as detail_service_period_end'");
    expect(source).toContain('const hasCanonicalDetailPeriods = detailServicePeriodStarts.length > 0 || detailServicePeriodEnds.length > 0;');
    expect(source).toContain('? detailServicePeriodStarts[0] ?? null');
    expect(source).toContain(': toIsoString(row.billing_period_start);');
    expect(source).toContain('? detailServicePeriodEnds[detailServicePeriodEnds.length - 1] ?? null');
    expect(source).toContain(': toIsoString(row.billing_period_end);');
  });
});
