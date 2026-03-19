import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

const invoiceQueriesSource = readFileSync(
  path.join(repoRoot, 'packages/billing/src/actions/invoiceQueries.ts'),
  'utf8',
);
const invoiceModelSource = readFileSync(
  path.join(repoRoot, 'packages/billing/src/models/invoice.ts'),
  'utf8',
);
const exportSelectorSource = readFileSync(
  path.join(repoRoot, 'packages/billing/src/services/accountingExportInvoiceSelector.ts'),
  'utf8',
);

describe('authoritative recurring readers service-period wiring', () => {
  it('T272: authoritative recurring readers prefer canonical detail periods over invoice header periods whenever detail rows exist', () => {
    expect(invoiceQueriesSource).toContain('SELECT MIN(iid.service_period_start)');
    expect(invoiceQueriesSource).toContain('SELECT MAX(iid.service_period_end)');

    expect(invoiceModelSource).toContain('if (!chargeDetailRows || chargeDetailRows.length === 0) {');
    expect(invoiceModelSource).toContain('Historical flat invoices stay parent-only when canonical detail rows do not exist.');
    expect(invoiceModelSource).toContain('recurring_detail_periods: recurringDetailPeriods,');
    expect(invoiceModelSource).toContain('service_period_start: servicePeriodStarts[0] ?? null');
    expect(invoiceModelSource).toContain('service_period_end: servicePeriodEnds[servicePeriodEnds.length - 1] ?? null');

    expect(exportSelectorSource).toContain('const hasCanonicalDetailPeriods = recurringDetailPeriods.length > 0;');
    expect(exportSelectorSource).toContain('? recurringDetailPeriods[0]?.service_period_start ?? detailServicePeriodStarts[0] ?? null');
    expect(exportSelectorSource).toContain(': null;');
    expect(exportSelectorSource).toContain("? recurringDetailPeriods[recurringDetailPeriods.length - 1]?.service_period_end ??");
    expect(exportSelectorSource).toContain(': null;');
  });
});
