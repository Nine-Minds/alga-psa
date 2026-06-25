import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/InvoiceService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('invoice service top helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for payment totals, due dates, and recurring summaries', () => {
    const amountDueSection = sectionBetween('private async getInvoiceAmountDue', 'private async getInvoiceRecurringProvenance');
    const dueDateSection = sectionBetween('private async computeDueDate', 'private buildRecurringInvoiceSummaryQuery');
    const recurringSummarySection = sectionBetween('private buildRecurringInvoiceSummaryQuery', '// ============================================================================');

    expect(amountDueSection).toContain('tenantDb(');
    expect(amountDueSection).toContain(".table('invoice_payments')");
    expect(amountDueSection).not.toMatch(/trx\('invoice_payments'\)\s*\./);
    expect(amountDueSection).not.toMatch(/\.where\(\{\s*invoice_id: params\.invoiceId,\s*tenant: params\.tenantId\s*\}\)/);

    expect(dueDateSection).toContain('tenantDb(');
    expect(dueDateSection).toContain(".table('clients')");
    expect(dueDateSection).not.toMatch(/trx\('clients'\)\s*\./);
    expect(dueDateSection).not.toMatch(/\.where\(\{\s*client_id: clientId,\s*tenant\s*\}\)/);

    expect(recurringSummarySection).toContain('tenantDb(');
    expect(recurringSummarySection).toContain(".table('recurring_service_periods as rsp')");
    expect(recurringSummarySection).not.toMatch(/trx\('recurring_service_periods as rsp'\)\s*\./);
    expect(recurringSummarySection).not.toMatch(/\.where\('rsp\.tenant', context\.tenant\)/);
  });
});
