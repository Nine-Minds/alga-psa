import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { getAvailableHourBlockMinutes } from '@alga-psa/shared/billingClients/hourBlockService';

// Guarded DB test for the unfinalize lifecycle (29.8.18 Blocker 3): unfinalizing
// an invoice must never leave its hour block active/spendable. Unused blocks
// return to pending atomically with the invoice (a purchase_reversal audit row
// is written, FIFO burn can no longer select the block); blocks that have been
// used (immutable first_allocated_at marker, or live allocation rows) abort the
// unfinalization with an actionable error — invoice and block stay finalized.

const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

let db: Knex;
let tenant: string;
let userId: string;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId }, { tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: userId } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db })),
  };
});

interface Seed {
  invoiceId: string;
  blockId: string;
  clientId: string;
}

async function seed(overrides: {
  firstAllocatedAt?: string | null;
  withAllocationRows?: boolean;
}): Promise<Seed> {
  const clientId = uuidv4();
  const invoiceId = uuidv4();
  const blockId = uuidv4();
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  const itemId = uuidv4();
  await db('tenants').insert({ tenant, client_name: 'HB Unfinalize Tenant', email: 'hbunf@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Unfinalize Client' });
  await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Unfinalize Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Unfinalize Svc',
    custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
    unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('invoices').insert({
    invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: `HB-UNF-${invoiceId.slice(0, 8)}`,
    invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
    total_amount: 100000, subtotal: 100000, tax: 0, status: 'sent', is_manual: true, is_prepayment: false,
    credit_applied: 0, finalized_at: new Date().toISOString(),
  });
  await db('invoice_charges').insert({
    tenant, item_id: itemId, invoice_id: invoiceId, service_id: serviceId,
    description: 'Prepaid hour block — Unfinalize Svc', quantity: 10, unit_price: 10000,
    total_price: 100000, tax_rate: 0, is_manual: true,
  });
  await db('hour_blocks').insert({
    block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
    total_minutes: 600, remaining_minutes: overrides.firstAllocatedAt || overrides.withAllocationRows ? 480 : 600,
    hourly_rate: 10000, purchase_amount: 100000,
    currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
    source_invoice_id: invoiceId, source_invoice_charge_id: itemId, source_type: 'purchase',
    first_allocated_at: overrides.firstAllocatedAt ?? null,
  });
  if (overrides.withAllocationRows) {
    const entryUserId = uuidv4();
    await db('users').insert({
      tenant, user_id: entryUserId, username: `hbunf_${entryUserId.slice(0, 8)}`,
      hashed_password: 'x', email: `hbunf_${entryUserId.slice(0, 8)}@test.local`,
    });
    await db('time_entries').insert({
      tenant, entry_id: uuidv4(), user_id: entryUserId,
      work_date: '2026-08-10', work_timezone: 'UTC',
    });
    const entry = await db('time_entries').where({ tenant }).first();
    await db('hour_block_time_allocations').insert({
      tenant, block_id: blockId, time_entry_id: entry.entry_id, minutes: 120,
    });
  }
  return { invoiceId, blockId, clientId };
}

async function cleanup() {
  await db('hour_block_time_allocations').where({ tenant }).delete();
  await db('hour_block_service_scopes').where({ tenant }).delete();
  await db('hour_block_audit').where({ tenant }).delete();
  await db('hour_blocks').where({ tenant }).delete();
  await db('time_entries').where({ tenant }).delete();
  await db('users').where({ tenant }).delete();
  await db('invoice_charges').where({ tenant }).delete();
  await db('invoices').where({ tenant }).delete();
  await db('service_catalog').where({ tenant }).delete();
  await db('service_types').where({ tenant }).delete();
  await db('clients').where({ tenant }).delete();
  await db('tenants').where({ tenant }).delete();
}

describe.runIf(enabled)('unfinalizeInvoice hour-block lifecycle (Blocker 3)', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
    userId = uuidv4();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('unused block: unfinalize returns the block to pending and FIFO burn can no longer select it', async () => {
    const { invoiceId, blockId, clientId } = await seed({});
    try {
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(600);

      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      const result = await unfinalizeInvoice(invoiceId);
      expect(result).toEqual({ success: true });

      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      expect(invoice.status).toBe('draft');
      expect(invoice.finalized_at).toBeNull();

      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('pending');
      expect(block.purchased_at).toBeNull();
      // Mint-time economics are retained for the next finalization.
      expect(block.total_minutes).toBe(600);
      expect(block.remaining_minutes).toBe(600);

      const audit = await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'purchase_reversal' }).first();
      expect(audit).toBeTruthy();
      expect(audit.reason).toBe('Invoice unfinalized');
      expect(audit.metadata.source_invoice_id).toBe(invoiceId);

      // The block is unavailable to burn while the invoice is a draft.
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('unused block: refinalizing activates it again (coherent pending → active → pending → active cycle)', async () => {
    const { invoiceId, blockId, clientId } = await seed({});
    try {
      const { unfinalizeInvoice, activateHourBlocksForFinalizedInvoice } = await import('../src/actions/invoiceModification');
      await unfinalizeInvoice(invoiceId);
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(0);

      await activateHourBlocksForFinalizedInvoice(invoiceId, db, tenant, userId);

      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');
      expect(block.purchased_at).toBeTruthy();
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(600);
    } finally {
      await cleanup();
    }
  });

  it('used block (immutable marker set): unfinalization is rejected with an actionable error and nothing rolls back', async () => {
    const { invoiceId, blockId } = await seed({ firstAllocatedAt: new Date().toISOString() });
    try {
      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      const result = await unfinalizeInvoice(invoiceId);

      expect(result).toHaveProperty('actionError');
      const message = (result as { actionError: string }).actionError;
      expect(message).toContain(blockId);
      expect(message).toContain('2.0 of 10.0 hrs');
      expect(message).toContain('hour block');

      // Atomic rejection: invoice stays finalized, block stays active.
      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      expect(invoice.status).toBe('sent');
      expect(invoice.finalized_at).toBeTruthy();
      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');
      expect(await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'purchase_reversal' }).first()).toBeFalsy();
    } finally {
      await cleanup();
    }
  });

  it('used block (live allocation rows only, marker null): unfinalization is still rejected (belt-and-suspenders)', async () => {
    const { invoiceId, blockId } = await seed({ withAllocationRows: true });
    try {
      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      const result = await unfinalizeInvoice(invoiceId);

      expect(result).toHaveProperty('actionError');
      expect((result as { actionError: string }).actionError).toContain(blockId);

      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      expect(invoice.status).toBe('sent');
      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');
    } finally {
      await cleanup();
    }
  });
});
