/**
 * Database-backed read-back regression for the Xero CSV tax import (alga0002091).
 *
 * The Xero Invoice Details report carries major-unit amounts. The import must
 * scale them into minor units by the matched Alga invoice's own currency: a
 * 0-digit currency (JPY) stores 1000 yen as 1000, while USD 10.00 stores 1000
 * cents. The pre-fix code multiplied every currency by 100, inflating JPY 100x.
 *
 * Real service, real Postgres, tenant context via runWithTenant — mirrors the
 * smoke-test reproduction; no DB or conversion mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../actions/_dbTestUtils';
import { runWithTenant } from '@alga-psa/db';
import { getXeroCsvTaxImportService } from './xeroCsvTaxImportService';

const tenant = uuidv4();

interface Fixture {
  currency: string;
  invoiceId: string;
  invoiceNumber: string;
  /** Major-unit tax exactly as the Xero report would print it. */
  reportTax: string;
  /** Major-unit line amount exactly as the Xero report would print it. */
  reportAmount: string;
}

const fixtures: Fixture[] = [
  { currency: 'JPY', invoiceId: uuidv4(), invoiceNumber: 'XCSV-JPY-1', reportTax: '1000', reportAmount: '10000' },
  { currency: 'USD', invoiceId: uuidv4(), invoiceNumber: 'XCSV-USD-1', reportTax: '10.00', reportAmount: '100.00' }
];

let db: Knex;

function buildReportCsv(rows: Fixture[]): string {
  const header = 'Invoice Number,Contact Name,Line Amount,Tax Amount,External Invoice ID,Source System';
  const body = rows.map(
    (f) => `${f.invoiceNumber},Contact ${f.currency},${f.reportAmount},${f.reportTax},${f.invoiceId},AlgaPSA`
  );
  return [header, ...body].join('\n');
}

async function seedPendingExternalInvoice(f: Fixture): Promise<void> {
  const clientId = uuidv4();
  await db('clients').insert({
    tenant,
    client_id: clientId,
    client_name: `Client ${f.currency}`,
    default_currency_code: f.currency,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  // Both invoices carry subtotal 10000 minor units with no internal tax yet;
  // the import is expected to land 1000 minor units of tax on each.
  await db('invoices').insert({
    tenant,
    invoice_id: f.invoiceId,
    client_id: clientId,
    invoice_number: f.invoiceNumber,
    invoice_date: '2026-10-10',
    due_date: '2026-11-09',
    status: 'sent',
    subtotal: 10000,
    tax: 0,
    total_amount: 10000,
    currency_code: f.currency,
    tax_source: 'pending_external',
    is_manual: true,
    finalized_at: new Date()
  });
  await db('invoice_charges').insert({
    tenant,
    item_id: uuidv4(),
    invoice_id: f.invoiceId,
    description: `2 x 5000 minor units (${f.currency})`,
    quantity: 2,
    unit_price: 5000,
    net_amount: 10000,
    tax_amount: 0,
    total_price: 10000,
    is_manual: true,
    is_taxable: true
  });
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  await db('tenants').insert({
    tenant,
    client_name: `Xero CSV tax import ${tenant.slice(0, 8)}`,
    email: `xero-csv-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  for (const f of fixtures) {
    await seedPendingExternalInvoice(f);
  }
});

afterAll(async () => {
  await db('external_tax_imports').where({ tenant }).del();
  await db('invoice_charges').where({ tenant }).del();
  await db('invoices').where({ tenant }).del();
  await db('clients').where({ tenant }).del();
  await db('tenants').where({ tenant }).del();
  await db.destroy().catch(() => undefined);
});

describe('XeroCsvTaxImportService read-back scaling (alga0002091)', () => {
  it('stores imported tax in each invoice’s own minor units: JPY 1000 → 1000, USD 10.00 → 1000', async () => {
    const csv = buildReportCsv(fixtures);

    const result = await runWithTenant(tenant, () =>
      getXeroCsvTaxImportService().importTaxFromReport(csv)
    );

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);

    for (const f of fixtures) {
      const perInvoice = result.results.find((r) => r.invoiceId === f.invoiceId);
      expect(perInvoice, `${f.currency} result`).toBeDefined();
      expect(perInvoice!.importedTax, `${f.currency} importedTax`).toBe(1000);

      const charges = await db('invoice_charges')
        .where({ tenant, invoice_id: f.invoiceId })
        .select('external_tax_amount');
      const externalTax = charges.reduce((sum, c) => sum + Number(c.external_tax_amount ?? 0), 0);
      expect(externalTax, `${f.currency} external_tax_amount`).toBe(1000);

      const invoice = await db('invoices')
        .where({ tenant, invoice_id: f.invoiceId })
        .first('total_amount', 'tax_source');
      expect(Number(invoice!.total_amount), `${f.currency} total_amount`).toBe(11000);
      expect(invoice!.tax_source).toBe('external');

      const record = await db('external_tax_imports')
        .where({ tenant, invoice_id: f.invoiceId })
        .first('imported_external_tax');
      expect(Number(record!.imported_external_tax), `${f.currency} imported_external_tax`).toBe(1000);
    }
  });
});
