import { describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { activateHourBlocksForFinalizedInvoice } from '../src/actions/invoiceModification';

// Guarded DB test for the invoice-finalize hook that mints hour blocks. Run
// explicitly with HOUR_BLOCK_DB_TESTS=1 (see hourBlockService.db.test.ts).

const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

describe.runIf(enabled)('activateHourBlocksForFinalizedInvoice', () => {
  it('activates pending blocks linked to a finalized invoice and writes a purchase audit row', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    const clientId = uuidv4();
    const invoiceId = uuidv4();
    const blockId = uuidv4();

    try {
      await db('tenants').insert({ tenant, client_name: 'HB Finalize Tenant', email: 'hb2@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Finalize Client' });
      const serviceTypeId = uuidv4();
      const serviceId = uuidv4();
      await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Finalize Type', is_active: true, order_number: 1 });
      await db('service_catalog').insert({
        service_id: serviceId, tenant, service_name: 'Finalize Svc',
        custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
        unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
      });
      await db('invoices').insert({
        invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: 'HB-FIN-1',
        invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
        total_amount: 1000, subtotal: 1000, tax: 0, status: 'sent', is_manual: true, is_prepayment: false, credit_applied: 0,
      });
      // The finalize hook syncs the block from the authoritative purchase line;
      // an invoice with no line at all now counts as line-removed (block voided).
      // This legacy-shaped block (no explicit charge linkage) resolves the sole
      // service-matching charge.
      const itemId = uuidv4();
      await db('invoice_charges').insert({
        tenant, item_id: itemId, invoice_id: invoiceId, service_id: serviceId,
        description: 'Prepaid hour block — Finalize Svc', quantity: 10, unit_price: 10000,
        total_price: 100000, tax_rate: 0, is_manual: true,
      });
      await db('hour_blocks').insert({
        block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
        total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
        currency_code: 'USD', status: 'pending', purchased_at: null, source_invoice_id: invoiceId,
      });

      const userId = uuidv4();
      await activateHourBlocksForFinalizedInvoice(invoiceId, db, tenant, userId);

      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');
      expect(block.purchased_at).toBeTruthy();

      const audit = await db('hour_block_audit').where({ tenant, block_id: blockId }).first();
      expect(audit.type).toBe('purchase');
      expect(audit.created_by).toBe(userId);

      await db('hour_block_audit').where({ tenant }).delete();
      await db('hour_blocks').where({ tenant }).delete();
      await db('invoice_charges').where({ tenant }).delete();
      await db('invoices').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
    } finally {
      await db.destroy();
    }
  });
});
