import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';

// Guarded DB test for getHourBlockDetail user-name composition. The `users`
// table has no `full_name` column (it has first_name/last_name, both nullable,
// and a NOT NULL username), so the detail allocations query must select the
// real fields and compose a display name in JS. Run ONLY against an explicitly
// provided database with:
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

// getHourBlockDetail is withAuth-wrapped and calls createTenantKnex(); stub the
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

describe.runIf(enabled)('getHourBlockDetail user-name composition', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
    userId = uuidv4();
  });

  afterAll(async () => {
    await db.destroy();
  });

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

  async function seedProvenanceBlock(options: { sourceType: 'purchase' | 'grant'; withInvoice: boolean }) {
    const clientId = uuidv4();
    const blockId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'HB Detail Tenant', email: 'hbdet@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Detail Client' });
    const serviceTypeId = uuidv4();
    const serviceId = uuidv4();
    await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Detail Type', is_active: true, order_number: 1 });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: 'Detail Svc',
      custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
      unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    const invoiceId = options.withInvoice ? uuidv4() : null;
    if (invoiceId) {
      await db('invoices').insert({
        invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: 'HB-DET-LIVE-1',
        invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
        total_amount: 100000, subtotal: 100000, tax: 0, status: 'active', is_manual: true, is_prepayment: false, credit_applied: 0,
      });
    }
    await db('hour_blocks').insert({
      block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
      total_minutes: 600, remaining_minutes: 480, hourly_rate: 10000, purchase_amount: 100000,
      currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
      source_invoice_id: invoiceId, source_type: options.sourceType,
    });
    return { blockId, invoiceId };
  }

  it('surfaces a live source invoice number for a purchase-sourced block (drawer branch 1)', async () => {
    const { blockId, invoiceId } = await seedProvenanceBlock({ sourceType: 'purchase', withInvoice: true });

    try {
      const { getHourBlockDetail } = await import('../src/actions/hourBlockActions');
      const result = await getHourBlockDetail(blockId);

      expect('block' in result).toBe(true);
      const block = (result as { block: Record<string, any> }).block;
      expect(block.source_invoice_id).toBe(invoiceId);
      expect(block.source_type).toBe('purchase');
      expect(block.invoice_number).toBe('HB-DET-LIVE-1');
    } finally {
      await cleanup();
    }
  });

  it('keeps purchase provenance but no invoice number when the source invoice is deleted (drawer branch 2)', async () => {
    const { blockId } = await seedProvenanceBlock({ sourceType: 'purchase', withInvoice: false });

    try {
      const { getHourBlockDetail } = await import('../src/actions/hourBlockActions');
      const result = await getHourBlockDetail(blockId);

      expect('block' in result).toBe(true);
      const block = (result as { block: Record<string, any> }).block;
      expect(block.source_type).toBe('purchase');
      expect(block.source_invoice_id).toBeNull();
      expect(block.invoice_number).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('carries no invoice fields for a direct grant (drawer branch 3)', async () => {
    const { blockId } = await seedProvenanceBlock({ sourceType: 'grant', withInvoice: false });

    try {
      const { getHourBlockDetail } = await import('../src/actions/hourBlockActions');
      const result = await getHourBlockDetail(blockId);

      expect('block' in result).toBe(true);
      const block = (result as { block: Record<string, any> }).block;
      expect(block.source_type).toBe('grant');
      expect(block.source_invoice_id).toBeNull();
      expect(block.invoice_number).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('carries the catalog service name (not a bare UUID) in the detail payload and scope rows', async () => {
    const clientId = uuidv4();
    const blockId = uuidv4();
    const serviceTypeId = uuidv4();
    const serviceId = uuidv4();
    const scopeServiceId = uuidv4();

    try {
      await db('tenants').insert({ tenant, client_name: 'HB Detail Tenant', email: 'hbdet@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Detail Client' });
      await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Detail Type', is_active: true, order_number: 1 });
      for (const [id, name] of [[serviceId, 'Basic Support'], [scopeServiceId, 'Scope Svc']] as const) {
        await db('service_catalog').insert({
          service_id: id, tenant, service_name: name,
          custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
          unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
        });
      }
      await db('hour_blocks').insert({
        block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
        total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
        currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
        source_invoice_id: null, source_type: 'grant',
      });
      await db('hour_block_service_scopes').insert({
        tenant, block_id: blockId, service_id: scopeServiceId,
      });

      const { getHourBlockDetail } = await import('../src/actions/hourBlockActions');
      const result = await getHourBlockDetail(blockId);

      expect('block' in result).toBe(true);
      const detail = result as {
        block: { service_name?: string; service_id: string };
        scopes: Array<{ service_id: string; service_name?: string }>;
      };
      expect(detail.block.service_name).toBe('Basic Support');
      // The human name must be present instead of the raw UUID leaking through.
      expect(detail.block.service_name).not.toMatch(/^[0-9a-f]{8}-/);
      expect(detail.scopes).toHaveLength(1);
      expect(detail.scopes[0].service_name).toBe('Scope Svc');
    } finally {
      await cleanup();
    }
  });

  it('composes allocation user_name from first/last name with a username fallback and does not throw', async () => {
    const clientId = uuidv4();
    const blockId = uuidv4();
    const entryNamedId = uuidv4();
    const entryNullNameId = uuidv4();
    const userWithName = uuidv4();
    const userNullName = uuidv4();

    try {
      await db('tenants').insert({ tenant, client_name: 'HB Detail Tenant', email: 'hbdet@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Detail Client' });
      const serviceTypeId = uuidv4();
      const serviceId = uuidv4();
      await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Detail Type', is_active: true, order_number: 1 });
      await db('service_catalog').insert({
        service_id: serviceId, tenant, service_name: 'Detail Svc',
        custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
        unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
      });
      await db('users').insert({
        user_id: userWithName, tenant, username: `named_${userWithName.slice(0, 8)}`,
        first_name: 'Smoke', last_name: 'Admin',
        hashed_password: 'x', email: `named_${userWithName.slice(0, 8)}@test.local`, user_type: 'internal',
      });
      await db('users').insert({
        user_id: userNullName, tenant, username: 'glinda',
        first_name: null, last_name: null,
        hashed_password: 'x', email: 'glinda@test.local', user_type: 'internal',
      });
      await db('hour_blocks').insert({
        block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
        total_minutes: 600, remaining_minutes: 480, hourly_rate: 10000, purchase_amount: 100000,
        currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
        source_invoice_id: null, source_type: 'grant',
      });

      const start = new Date('2026-08-14T09:00:00.000Z');
      const end = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
      for (const [entryId, entryUserId] of [[entryNamedId, userWithName], [entryNullNameId, userNullName]] as const) {
        await db('time_entries').insert({
          entry_id: entryId, tenant, user_id: entryUserId, service_id: serviceId,
          work_item_id: null, work_item_type: 'ad_hoc',
          start_time: start.toISOString(), end_time: end,
          work_date: '2026-08-14', work_timezone: 'UTC', billable_duration: 60,
          approval_status: 'APPROVED', invoiced: false, contract_line_id: null,
        });
        await db('hour_block_time_allocations').insert({
          tenant, allocation_id: uuidv4(), block_id: blockId, time_entry_id: entryId, minutes: 60,
        });
      }
      await db('hour_block_audit').insert({
        tenant, block_id: blockId, type: 'grant', reason: 'detail test grant', created_by: userId,
      });

      const { getHourBlockDetail } = await import('../src/actions/hourBlockActions');
      const result = await getHourBlockDetail(blockId);

      expect('block' in result).toBe(true);
      const detail = result as { block: { block_id: string }; allocations: Array<Record<string, any>> };
      expect(detail.block.block_id).toBe(blockId);
      expect(detail.allocations).toHaveLength(2);
      const byEntry = new Map(detail.allocations.map((a) => [a.time_entry_id, a]));
      expect(byEntry.get(entryNamedId)?.user_name).toBe('Smoke Admin');
      expect(byEntry.get(entryNullNameId)?.user_name).toBe('glinda');
      // The raw name fields are internal only and must not leak into the payload.
      expect(byEntry.get(entryNamedId)?.user_first_name).toBeUndefined();
      expect(byEntry.get(entryNullNameId)?.user_last_name).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
