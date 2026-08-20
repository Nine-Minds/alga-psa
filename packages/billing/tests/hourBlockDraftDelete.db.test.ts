import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';

// Guarded DB test for the draft-invoice deletion hook that voids pending hour
// blocks. Run ONLY against an explicitly provided database with:
//   HOUR_BLOCK_DB_HOST HOUR_BLOCK_DB_PORT HOUR_BLOCK_DB_USER
//   HOUR_BLOCK_DB_PASSWORD HOUR_BLOCK_DB_NAME HOUR_BLOCK_DB_TESTS=1
// The suite creates an isolated tenant and cleans up after itself. Skipped by
// default so CI (which has no test DB) stays green.

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

// hardDeleteInvoice is withAuth-wrapped and calls createTenantKnex(); stub the
// auth stack and point the connection at the real test DB. Everything else
// (tenantDb, withTransaction) keeps its real implementation.
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
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

describe.runIf(enabled)('hardDeleteInvoice hour-block voiding', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
    userId = uuidv4();
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function seedInvoice(blockStatus: string) {
    const clientId = uuidv4();
    const invoiceId = uuidv4();
    const blockId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'HB DraftDelete Tenant', email: 'hb3@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB DraftDelete Client' });
    const serviceTypeId = uuidv4();
    const serviceId = uuidv4();
    await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB DraftDelete Type', is_active: true, order_number: 1 });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: 'DraftDelete Svc',
      custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
      unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    await db('invoices').insert({
      invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: 'HB-DEL-1',
      invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
      total_amount: 1000, subtotal: 1000, tax: 0, status: 'draft', is_manual: true, is_prepayment: false, credit_applied: 0,
    });
    await db('invoice_charges').insert({
      tenant, item_id: uuidv4(), invoice_id: invoiceId, service_id: serviceId,
      description: 'Prepaid hour block — DraftDelete Svc', quantity: 10, unit_price: 10000,
      total_price: 100000, tax_rate: 0, is_manual: true,
    });
    await db('hour_blocks').insert({
      block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
      total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
      currency_code: 'USD', status: blockStatus, purchased_at: null, source_invoice_id: invoiceId,
      source_type: 'purchase',
    });
    return { invoiceId, blockId, clientId };
  }

  async function seedGrant() {
    const clientId = uuidv4();
    const blockId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'HB Grant Tenant', email: 'hbg@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Grant Client' });
    const serviceTypeId = uuidv4();
    const serviceId = uuidv4();
    await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Grant Type', is_active: true, order_number: 1 });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: 'Grant Svc',
      custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
      unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    await db('hour_blocks').insert({
      block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
      total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 0,
      currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
      source_invoice_id: null, source_type: 'grant',
    });
    return { blockId, clientId };
  }

  async function cleanup() {
    await db('hour_blocks').where({ tenant }).delete();
    await db('invoice_charges').where({ tenant }).delete();
    await db('invoices').where({ tenant }).delete();
    await db('service_catalog').where({ tenant }).delete();
    await db('service_types').where({ tenant }).delete();
    await db('clients').where({ tenant }).delete();
    await db('tenants').where({ tenant }).delete();
  }

  it('voids a pending block linked to a deleted draft invoice and writes a void audit row', async () => {
    const { invoiceId, blockId } = await seedInvoice('pending');

    try {
      const { hardDeleteInvoice } = await import('../src/actions/invoiceModification');
      const result = await hardDeleteInvoice(invoiceId);

      expect(result).toEqual({ success: true });

      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('voided');
      expect(block.voided_at).toBeTruthy();
      expect(block.voided_by).toBe(userId);
      expect(block.void_reason).toBe('Draft purchase invoice deleted');
      expect(block.source_invoice_id).toBeNull();
      expect(block.source_type).toBe('purchase');

      const audit = await db('hour_block_audit').where({ tenant, block_id: blockId }).first();
      expect(audit).toBeTruthy();
      expect(audit.type).toBe('void');
      expect(audit.reason).toBe('Draft purchase invoice deleted');
      expect(audit.created_by).toBe(userId);

      const orphaned = await db('hour_blocks')
        .where({ tenant, status: 'pending' })
        .whereNull('source_invoice_id')
        .count({ count: '*' })
        .first();
      expect(Number(orphaned?.count ?? 0)).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('refuses to delete the invoice when a linked block is not pending (defensive guard)', async () => {
    const { invoiceId, blockId } = await seedInvoice('active');

    try {
      const { hardDeleteInvoice } = await import('../src/actions/invoiceModification');
      const result = await hardDeleteInvoice(invoiceId);

      expect(result).toHaveProperty('actionError');

      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');

      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      expect(invoice).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('keeps purchase provenance through listHourBlocks after the draft invoice is deleted', async () => {
    const { invoiceId, blockId, clientId } = await seedInvoice('pending');

    try {
      const { hardDeleteInvoice } = await import('../src/actions/invoiceModification');
      const result = await hardDeleteInvoice(invoiceId);
      expect(result).toEqual({ success: true });

      const { listHourBlocks } = await import('../src/actions/hourBlockActions');
      const rows = await listHourBlocks(clientId);

      expect(Array.isArray(rows)).toBe(true);
      const row = (rows as Array<Record<string, any>>).find((r) => r.block_id === blockId);
      expect(row).toBeTruthy();
      expect(row.source_type).toBe('purchase');
      expect(row.invoice_number).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('reads a direct grant as grant through listHourBlocks', async () => {
    const { blockId, clientId } = await seedGrant();

    try {
      const { listHourBlocks } = await import('../src/actions/hourBlockActions');
      const rows = await listHourBlocks(clientId);

      expect(Array.isArray(rows)).toBe(true);
      const row = (rows as Array<Record<string, any>>).find((r) => r.block_id === blockId);
      expect(row).toBeTruthy();
      expect(row.source_type).toBe('grant');
      expect(row.invoice_number).toBeNull();
    } finally {
      await cleanup();
    }
  });
});
