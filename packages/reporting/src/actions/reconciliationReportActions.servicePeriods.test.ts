import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./reconciliationReportActions.ts', import.meta.url), 'utf8');

describe('reconciliation report actions recurring timing basis', () => {
  it('keeps reconciliation reporting tied to discrepancy status and totals instead of recurring invoice period projection', () => {
    expect(source).toContain('CreditReconciliationReport.listReports({');
    expect(source).toContain("const totalAmount = await CreditReconciliationReport.getTotalDiscrepancyAmount();");
    expect(source).toContain("const openCount = await CreditReconciliationReport.countByStatus('open');");
    expect(source).not.toContain('invoice_charge_details');
    expect(source).not.toContain('service_period_start');
    expect(source).not.toContain('service_period_end');
  });
});
