import { describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import { createPendingHourBlockForInvoiceCharge } from '../src/services/pendingHourBlockService';

// Guarded DB test; run with HOUR_BLOCK_DB_TESTS=1 (see hourBlockService.db.test.ts).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

describe.runIf(enabled)('createPendingHourBlockForInvoiceCharge', () => {
  it('creates ad-hoc and contract pending blocks with scopes and linkage', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    const clientId = uuidv4();
    const serviceId = uuidv4();
    const scopeSvc = uuidv4();
    const typeId = uuidv4();
    const invoiceId = uuidv4();
    const chargeId = uuidv4();
    const contractId = uuidv4();
    const clientContractId = uuidv4();
    const lineId = uuidv4();
    try {
      await db('tenants').insert({ tenant, client_name: 'PHB Tenant', email: 'phb@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'PHB Client' });
      await db('service_types').insert({ id: typeId, tenant, name: 'PHB Type', is_active: true, order_number: 1 });
      for (const [id, name] of [[serviceId, 'PHB Svc'], [scopeSvc, 'PHB Scope Svc']]) {
        await db('service_catalog').insert({
          service_id: id, tenant, service_name: name, custom_service_type_id: typeId,
          billing_method: 'hourly', default_rate: 10000, unit_of_measure: 'hour',
          category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
        });
      }
      await db('invoices').insert({
        invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: 'PHB-1',
        invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
        total_amount: 0, subtotal: 0, tax: 0, status: 'draft', is_manual: true, is_prepayment: false, credit_applied: 0,
      });
      await db('invoice_charges').insert({
        tenant, item_id: chargeId, invoice_id: invoiceId, service_id: serviceId,
        description: 'x', quantity: 10, unit_price: 10000, total_price: 100000, tax_rate: 0, is_manual: true,
      });
      await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'PHB Contract' });
      await db('client_contracts').insert({
        tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
        start_date: '2026-01-01', is_active: true,
      });
      await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'PHB Line' });

      const base = {
        tenant, clientId, serviceId, minutes: 600, hourlyRate: 10000, purchaseAmount: 100000,
        currencyCode: 'EUR', invoiceId, invoiceChargeId: chargeId,
      };

      const adhoc = await db.transaction((trx) => createPendingHourBlockForInvoiceCharge(trx, {
        ...base, sourceType: 'purchase', expirationDate: '2027-01-31',
        scopeServiceIds: [scopeSvc], createdBy: null, notes: '  hello  ',
      }));
      const a = await db('hour_blocks').where({ tenant, block_id: adhoc.blockId }).first();
      expect(a).toMatchObject({
        status: 'pending', total_minutes: 600, remaining_minutes: 600, currency_code: 'EUR',
        source_type: 'purchase', contract_line_id: null, client_contract_id: null, issuance_id: null,
        source_invoice_id: invoiceId, source_invoice_charge_id: chargeId, notes: 'hello',
      });
      expect(Number(a.purchase_amount)).toBe(100000);
      expect(a.purchased_at).toBeNull();
      const aScopes = await db('hour_block_service_scopes').where({ tenant, block_id: adhoc.blockId });
      expect(aScopes.map((s) => s.service_id)).toEqual([scopeSvc]);
      expect(await db('hour_block_audit').where({ tenant, block_id: adhoc.blockId })).toHaveLength(0);

      const contract = await db.transaction((trx) => createPendingHourBlockForInvoiceCharge(trx, {
        ...base, sourceType: 'contract', contractLineId: lineId, clientContractId, servicePeriodRecordId: uuidv4(),
        scopeServiceIds: [serviceId, scopeSvc],
      }));
      const c = await db('hour_blocks').where({ tenant, block_id: contract.blockId }).first();
      expect(c).toMatchObject({
        status: 'pending', source_type: 'contract', contract_line_id: lineId,
        client_contract_id: clientContractId, replenishment_bucket_usage_id: null, notes: null,
      });
      expect(await db('hour_block_service_scopes').where({ tenant, block_id: contract.blockId })).toHaveLength(2);

      await expect(db.transaction((trx) => createPendingHourBlockForInvoiceCharge(trx, {
        ...base, sourceType: 'contract', currencyCode: '',
      }))).rejects.toThrow(/currencyCode is required/);
    } finally {
      await db('hour_block_service_scopes').where({ tenant }).delete();
      await db('hour_blocks').where({ tenant }).delete();
      await db('invoice_charges').where({ tenant }).delete();
      await db('invoices').where({ tenant }).delete();
      await db('contract_lines').where({ tenant }).delete();
      await db('client_contracts').where({ tenant }).delete();
      await db('contracts').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
      await db.destroy();
    }
  });
});
