import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const invoiceQueriesSource = fs.readFileSync(
  path.resolve(__dirname, '../src/actions/invoiceQueries.ts'),
  'utf8'
);

describe('invoiceQueries recurring detail refresh wiring', () => {
  it('T208: list summaries flatten canonical detail periods, while rerender and preview-refresh stay on the full detail-aware invoice reader', () => {
    expect(invoiceQueriesSource).toContain('SELECT MIN(iid.service_period_start)');
    expect(invoiceQueriesSource).toContain('SELECT MAX(iid.service_period_end)');
    expect(invoiceQueriesSource).toContain('return Invoice.getFullInvoiceById(knex, tenant, invoiceId);');
    expect(invoiceQueriesSource).toContain('detail-aware reader');
  });
});
