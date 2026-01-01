import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { AccountingExportInvoiceSelector } from 'server/src/lib/services/accountingExportInvoiceSelector';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 120_000;

describe('CSV export invoice selection', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: ['tenant_external_entity_mappings', 'invoice_charges', 'invoices', 'service_catalog']
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    await ctx.db('tenant_external_entity_mappings').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
    await ctx.db('service_catalog').where({ tenant: ctx.tenantId }).del();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function seedInvoice(): Promise<{ invoiceId: string; chargeId: string }> {
    const invoiceId = uuidv4();
    const chargeId = uuidv4();

    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: 'INV-CSV-1001',
      invoice_date: new Date().toISOString(),
      due_date: new Date().toISOString(),
      total_amount: 1000,
      currency_code: 'USD',
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await ctx.db('invoice_charges').insert({
      item_id: chargeId,
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      description: 'CSV export charge',
      quantity: 1,
      unit_price: 1000,
      net_amount: 1000,
      total_price: 1000,
      tax_amount: 0,
      tax_region: null,
      is_manual: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    return { invoiceId, chargeId };
  }

  it('excludes invoices that already have a quickbooks_csv invoice mapping', async () => {
    const { invoiceId } = await seedInvoice();

    await ctx.db('tenant_external_entity_mappings').insert({
      id: uuidv4(),
      tenant: ctx.tenantId,
      integration_type: 'quickbooks_csv',
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId,
      external_entity_id: 'csv:INV-CSV-1001',
      external_realm_id: null,
      sync_status: 'synced',
      metadata: { last_exported_at: new Date().toISOString() },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const selector = await AccountingExportInvoiceSelector.create();
    const preview = await selector.previewInvoiceLines({
      adapterType: 'quickbooks_csv',
      targetRealm: null,
      excludeSyncedInvoices: true
    });

    expect(preview.some((row) => row.invoiceId === invoiceId)).toBe(false);
  });
});
