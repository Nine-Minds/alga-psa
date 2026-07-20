import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const invoiceQueriesSource = fs.readFileSync(
  path.resolve(__dirname, '../src/actions/invoiceQueries.ts'),
  'utf8'
);

describe('invoiceQueries recurring detail refresh wiring', () => {
  it('T208: list summaries flatten canonical detail periods, while rerender and preview-refresh stay on the full detail-aware invoice reader', () => {
    expect(invoiceQueriesSource).toContain("buildInvoiceDetailServicePeriodSubquery(db, 'min', 'invoices')");
    expect(invoiceQueriesSource).toContain("buildInvoiceDetailServicePeriodSubquery(db, 'max', 'invoices')");
    expect(invoiceQueriesSource).toContain("db.tenantJoin(subquery, 'invoice_charge_details as iid'");
    expect(invoiceQueriesSource).toContain("db.tenantWhereColumn(subquery, 'ic.tenant', `${outerInvoiceAlias}.tenant`)");
    expect(invoiceQueriesSource).toContain('await Invoice.getFullInvoiceById(knex, tenant, invoiceId);');
    expect(invoiceQueriesSource).toContain('detail-aware reader');
    // The rerender path still hydrates through the detail-aware reader, then
    // enriches with project rendering data.
    expect(invoiceQueriesSource).toContain('enrichInvoiceWithProjectRenderingData(');
  });
});
