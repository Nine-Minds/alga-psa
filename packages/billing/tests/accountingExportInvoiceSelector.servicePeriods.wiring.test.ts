import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/services/accountingExportInvoiceSelector.ts', import.meta.url),
  'utf8'
);

describe('accountingExportInvoiceSelector service-period wiring', () => {
  it('prefers canonical detail periods and does not emit invoice-header fallback service periods for live export lines', () => {
    expect(source).toContain(".leftJoin('invoice_charge_details as iid'");
    expect(source).toContain("'iid.service_period_start as detail_service_period_start'");
    expect(source).toContain("'iid.service_period_end as detail_service_period_end'");
    expect(source).toContain('const hasCanonicalDetailPeriods = recurringDetailPeriods.length > 0;');
    expect(source).toContain("? recurringDetailPeriods[0]?.service_period_start ?? detailServicePeriodStarts[0] ?? null");
    expect(source).toContain("? recurringDetailPeriods[recurringDetailPeriods.length - 1]?.service_period_end ??");
    expect(source).toContain(': null;');
    expect(source).not.toContain("return 'invoice_header_fallback';");
    expect(source).toContain("return 'financial_document_fallback';");
  });
});
