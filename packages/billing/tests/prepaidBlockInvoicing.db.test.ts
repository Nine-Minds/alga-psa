import { describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';
import { BillingEngine } from '../src/lib/billing/billingEngine';
import { persistInvoiceCharges } from '../src/services/invoiceService';
import { applyPrepaidCoverage } from '../src/lib/billing/chargeResolution/prepaidBlockRules';

// Guarded DB test for Prepaid Block invoicing (engine + persistence). Run with
// HOUR_BLOCK_DB_TESTS=1 (see hourBlockService.db.test.ts for the env vars).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

interface World {
  db: Knex;
  tenant: string;
  clientId: string;
  userId: string;
  ticketId: string;
  serviceId: string;
  lineId: string;
  clientContractId: string;
  issuanceId: string;
}

async function setup(): Promise<World> {
  const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  const tenant = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const serviceId = uuidv4();
  const userId = uuidv4();
  const ticketId = uuidv4();
  const contractId = uuidv4();
  const lineId = uuidv4();
  const clientContractId = uuidv4();
  const issuanceId = uuidv4();

  await db('tenants').insert({ tenant, client_name: 'PBI Tenant', email: 'pbi@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBI Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBI Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Remote Support', custom_service_type_id: typeId,
    billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour',
    category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('users').insert({
    user_id: userId, tenant, username: `pbi_${userId.slice(0, 8)}`, hashed_password: 'x',
    email: `pbi_${userId.slice(0, 8)}@test.local`, user_type: 'internal', first_name: 'P', last_name: 'B',
  });
  await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'PBI', ticket_number: `PBI-${ticketId.slice(0, 8)}` });
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'PBI Contract', currency_code: 'EUR' });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
    start_date: '2026-01-01', is_active: true,
  });
  await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'PBI Line' });
  await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
  // 40 h block sold at 4,400.00 (minor units), 12 month expiry.
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: lineId, block_minutes: 2400, block_price: 440000,
    expiry_months: 12, sold_as_service_id: serviceId,
  });
  await db('contract_line_block_issuances').insert({
    tenant, issuance_id: issuanceId, contract_line_id: lineId, client_contract_id: clientContractId,
    client_id: clientId, trigger_kind: 'contract_start', due_date: '2026-03-31', status: 'scheduled',
  });
  return { db, tenant, clientId, userId, ticketId, serviceId, lineId, clientContractId, issuanceId };
}

async function teardown(w: World) {
  const { db, tenant } = w;
  for (const table of [
    'hour_block_time_allocations', 'hour_block_audit', 'hour_block_service_scopes', 'hour_blocks',
    'contract_line_block_issuances', 'invoice_charges', 'invoices', 'time_entries', 'tickets',
    'contract_line_prepaid_blocks', 'contract_line_services', 'client_billing_profiles', 'contract_lines', 'client_contracts',
    'contracts', 'service_catalog', 'service_types', 'users', 'clients', 'tenants',
  ]) {
    await db(table).where({ tenant }).delete();
  }
  await db.destroy();
}

async function insertEntry(w: World, minutes: number, hourOffset: number) {
  const entryId = uuidv4();
  const start = new Date(`2026-03-10T${String(8 + hourOffset).padStart(2, '0')}:00:00.000Z`);
  await w.db('time_entries').insert({
    entry_id: entryId, tenant: w.tenant, user_id: w.userId, service_id: w.serviceId,
    work_item_id: w.ticketId, work_item_type: 'ticket',
    start_time: start.toISOString(), end_time: new Date(start.getTime() + minutes * 60000).toISOString(),
    work_date: '2026-03-10', work_timezone: 'UTC', billable_duration: minutes,
    approval_status: 'APPROVED', invoiced: false, contract_line_id: w.lineId,
  });
  return entryId;
}

async function insertBlock(w: World, status: 'active' | 'pending' | 'expired', total = 600) {
  const blockId = uuidv4();
  await w.db('hour_blocks').insert({
    tenant: w.tenant, block_id: blockId, client_id: w.clientId, service_id: w.serviceId,
    total_minutes: total, remaining_minutes: total, hourly_rate: 11000, purchase_amount: 110000,
    currency_code: 'EUR', status, purchased_at: status === 'pending' ? null : new Date().toISOString(),
    source_type: 'contract', contract_line_id: w.lineId, service_period_record_id: uuidv4(),
  });
  return blockId;
}

async function allocate(w: World, blockId: string, entryId: string, minutes: number) {
  await w.db('hour_block_time_allocations').insert({
    tenant: w.tenant, allocation_id: uuidv4(), block_id: blockId, time_entry_id: entryId, minutes,
  });
}

describe.runIf(enabled)('Prepaid Block invoicing (engine)', () => {
  it('loadPrepaidBlockIssuanceCharges: quantity is hours, total is the block price, currency is the contract currency', async () => {
    const w = await setup();
    try {
      {
        const engine = BillingEngine.forTransaction(w.db as any, w.tenant);
        const charges = await (engine as any).loadPrepaidBlockIssuanceCharges(
          w.clientId,
          { startDate: '2026-03-31T00:00:00Z', endDate: '2026-04-01T00:00:00Z' },
          [w.issuanceId],
        );
        expect(charges).toHaveLength(1);
        expect(charges[0]).toMatchObject({
          type: 'prepaid_block', issuance_id: w.issuanceId, contract_line_id: w.lineId,
          quantity: 40, rate: 11000, total: 440000, currency_code: 'EUR',
          block_minutes: 2400, block_price: 440000, expiry_months: 12, billingTiming: 'advance',
          scope_service_ids: [w.serviceId],
        });
        expect(charges[0].quantity * charges[0].rate).toBe(charges[0].total);
      }
    } finally {
      await teardown(w);
    }
  });

  it('loadPrepaidBlockIssuanceCharges: non-scheduled issuance is rejected', async () => {
    const w = await setup();
    try {
      await w.db('contract_line_block_issuances').where({ tenant: w.tenant, issuance_id: w.issuanceId }).update({ status: 'cancelled' });
      const engine = BillingEngine.forTransaction(w.db as any, w.tenant);
      await expect((engine as any).loadPrepaidBlockIssuanceCharges(
        w.clientId, { startDate: '2026-03-31T00:00:00Z', endDate: '2026-04-01T00:00:00Z' }, [w.issuanceId],
      )).rejects.toThrow(/not scheduled/);
    } finally {
      await teardown(w);
    }
  });

  it('subtracts active-block allocations from billable time, and holds entries allocated to a pending block', async () => {
    const w = await setup();
    try {
      const active = await insertBlock(w, 'active');
      const pending = await insertBlock(w, 'pending');
      const covered = await insertEntry(w, 60, 0); // fully covered by the active block
      const partial = await insertEntry(w, 90, 2); // 60 covered, 30 overage
      const held = await insertEntry(w, 120, 4); // 60 active + 60 pending: held
      const plain = await insertEntry(w, 45, 6); // not allocated
      await allocate(w, active, covered, 60);
      await allocate(w, active, partial, 60);
      await allocate(w, active, held, 60);
      await allocate(w, pending, held, 60);

      // The production path: the engine supplies the line's allocation rows
      // (with block status) and the charge resolver's rule decides coverage.
      const engine = BillingEngine.forTransaction(w.db as any, w.tenant);
      const rows = await (engine as any).loadPrepaidCoverageRows(w.lineId, [covered, partial, held, plain]);
      const result = applyPrepaidCoverage([
        { sourceId: covered, billableMinutes: 60 },
        { sourceId: partial, billableMinutes: 90 },
        { sourceId: held, billableMinutes: 120 },
        { sourceId: plain, billableMinutes: 45 },
      ], rows);
      expect(result.map((e) => [e.sourceId, e.billableMinutes])).toEqual([
        [partial, 30],
        [plain, 45],
      ]);
    } finally {
      await teardown(w);
    }
  });

  it('contract hour-block info line marks covered entries and excludes held entries', async () => {
    const w = await setup();
    try {
      const active = await insertBlock(w, 'active');
      const pending = await insertBlock(w, 'pending');
      const covered = await insertEntry(w, 60, 0);
      const partial = await insertEntry(w, 90, 2);
      const held = await insertEntry(w, 120, 4);
      await allocate(w, active, covered, 60);
      await allocate(w, active, partial, 60);
      await allocate(w, active, held, 60);
      await allocate(w, pending, held, 60);

      const engine = BillingEngine.forTransaction(w.db as any, w.tenant);
      const line = {
        client_contract_line_id: w.lineId, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
        contract_name: 'PBI Contract',
      };
      const charges = await (engine as any).calculateContractLineHourBlockCharges(w.clientId, line, {
        servicePeriodRecordId: null, duePosition: 'arrears',
        servicePeriodStart: '2026-03-01', servicePeriodEnd: '2026-03-31',
        servicePeriodStartExclusive: '2026-03-01T00:00:00Z', servicePeriodEndExclusive: '2026-04-01T00:00:00Z',
        coverageRatio: 1,
      });
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({ type: 'hour_block', block_id: active, total: 0, rate: 0, client_contract_line_id: w.lineId });
      expect(charges[0].hoursUsed).toBeCloseTo(2, 5); // covered 60 + partial 60; held excluded
      expect(charges[0].coveredEntryIds).toEqual([covered]);
    } finally {
      await teardown(w);
    }
  });
});

describe.runIf(enabled)('Prepaid Block invoicing (persistence)', () => {
  async function generate(w: World, trx: Knex.Transaction, invoiceId: string) {
    const engine = BillingEngine.forTransaction(trx, w.tenant);
    const charges = await (engine as any).loadPrepaidBlockIssuanceCharges(
      w.clientId, { startDate: '2026-03-31T00:00:00Z', endDate: '2026-04-01T00:00:00Z' }, [w.issuanceId],
    );
    return persistInvoiceCharges(
      trx, invoiceId, charges, { client_id: w.clientId, tax_region: null },
      { user: { id: w.userId } } as any, w.tenant, { requireRecurringServicePeriodLinkage: false },
    );
  }

  async function makeInvoice(w: World, invoiceDate: string) {
    const invoiceId = uuidv4();
    await w.db('invoices').insert({
      invoice_id: invoiceId, tenant: w.tenant, client_id: w.clientId, invoice_number: `PBI-${invoiceId.slice(0, 6)}`,
      invoice_date: invoiceDate, due_date: invoiceDate, total_amount: 0, subtotal: 0, tax: 0, status: 'draft',
      is_manual: false, is_prepayment: false, credit_applied: 0, currency_code: 'EUR',
    });
    return invoiceId;
  }

  it('generate creates a pending block linked to the charge, with expiry from the invoice date', async () => {
    const w = await setup();
    try {
      const overflow = await insertEntry(w, 90, 0);
      const invoiceId = await makeInvoice(w, '2026-03-31');
      const subtotal = await w.db.transaction((trx) => generate(w, trx, invoiceId));
      expect(subtotal).toBe(440000);

      const charge = await w.db('invoice_charges').where({ tenant: w.tenant, invoice_id: invoiceId }).first();
      expect(charge).toMatchObject({ billing_charge_type: 'prepaid_block', service_id: w.serviceId });
      expect(Number(charge.net_amount)).toBe(440000);
      expect(Number(charge.quantity)).toBe(40);
      expect(Number(charge.unit_price)).toBe(11000);

      const block = await w.db('hour_blocks').where({ tenant: w.tenant, source_invoice_charge_id: charge.item_id }).first();
      expect(block).toMatchObject({
        status: 'pending', source_type: 'contract', contract_line_id: w.lineId,
        client_contract_id: w.clientContractId, issuance_id: w.issuanceId, currency_code: 'EUR',
        total_minutes: 2400, source_invoice_id: invoiceId,
      });
      expect(Number(block.purchase_amount)).toBe(440000);
      // 2026-03-31 + 12 months - 1 day
      expect(new Date(block.expiration_date).toISOString().slice(0, 10)).toBe('2027-03-30');
      expect((await w.db('hour_block_service_scopes').where({ tenant: w.tenant, block_id: block.block_id })).map((r) => r.service_id))
        .toEqual([w.serviceId]);

      const issuance = await w.db('contract_line_block_issuances').where({ tenant: w.tenant, issuance_id: w.issuanceId }).first();
      expect(issuance).toMatchObject({
        status: 'invoiced', block_id: block.block_id, invoice_id: invoiceId,
        invoice_charge_id: charge.item_id, currency_code: 'EUR',
      });

      // The line's existing uninvoiced time is re-drawn onto the new pending block.
      const allocations = await w.db('hour_block_time_allocations').where({ tenant: w.tenant, time_entry_id: overflow });
      expect(allocations.map((a) => [a.block_id, Number(a.minutes)])).toEqual([[block.block_id, 90]]);
    } finally {
      await teardown(w);
    }
  });

  it('double generation of one issuance fails and issues no second block', async () => {
    const w = await setup();
    try {
      const first = await makeInvoice(w, '2026-03-31');
      await w.db.transaction((trx) => generate(w, trx, first));
      const second = await makeInvoice(w, '2026-03-31');
      await expect(w.db.transaction(async (trx) => {
        // Stale charge (computed before the first generation committed) must still fail at the lock.
        const engine = BillingEngine.forTransaction(trx, w.tenant);
        const charge = {
          type: 'prepaid_block', issuance_id: w.issuanceId, contract_line_id: w.lineId, serviceId: w.serviceId,
          serviceName: 'Remote Support', block_minutes: 2400, block_price: 440000, currency_code: 'EUR',
          expiry_months: 12, scope_service_ids: [w.serviceId], quantity: 40, rate: 11000, total: 440000,
          tax_amount: 0, tax_rate: 0, billingTiming: 'advance',
        };
        void engine;
        return persistInvoiceCharges(
          trx, second, [charge as any], { client_id: w.clientId, tax_region: null },
          { user: { id: w.userId } } as any, w.tenant, { requireRecurringServicePeriodLinkage: false },
        );
      })).rejects.toThrow(/not scheduled/);
      expect(await w.db('hour_blocks').where({ tenant: w.tenant })).toHaveLength(1);
      expect(await w.db('invoice_charges').where({ tenant: w.tenant, invoice_id: second })).toHaveLength(0);
    } finally {
      await teardown(w);
    }
  });
});
