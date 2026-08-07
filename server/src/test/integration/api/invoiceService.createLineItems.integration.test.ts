import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// Line-item creation publishes INVOICE_ITEM_CREATED per item; the event bus is
// not under test here, so stub the publishers instead of requiring Redis.
vi.mock('../../../lib/eventBus/publishers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue(undefined),
    publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  };
});

import { InvoiceService } from '@/lib/api/services/InvoiceService';

type Fixture = {
  tenantId: string;
  clientId: string;
  invoiceId: string;
};

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'invoice_charges').del();
  await tenantTable(tenantId, 'invoices').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const clientId = uuidv4();
  const invoiceId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Invoice Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Invoice Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'invoices').insert({
    tenant: tenantId,
    invoice_id: invoiceId,
    invoice_number: `INV-${tenantId.slice(0, 8)}`,
    client_id: clientId,
    status: 'draft',
    invoice_date: '2026-08-06T00:00:00.000Z',
    due_date: '2026-09-05T00:00:00.000Z',
    subtotal: 0,
    tax: 0,
    total_amount: 0,
  });

  return { tenantId, clientId, invoiceId };
}

describe('invoice service line item persistence integration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantColumns = await schemaTable('tenants').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
  });

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  async function createLineItems(fixture: Fixture, items: any[]): Promise<any[]> {
    const service = new InvoiceService();
    const context = { tenant: fixture.tenantId, userId: uuidv4() } as any;

    await withTransaction(db, async (trx) => {
      await (service as any).createInvoiceLineItems(fixture.invoiceId, items, trx, context);
    });

    return tenantTable(fixture.tenantId, 'invoice_charges')
      .where({ invoice_id: fixture.invoiceId })
      .orderBy('created_at', 'asc');
  }

  // Regression alga0001984 follow-up: omitting net_amount on create is the
  // "calculate it for me" contract — the server derives it from
  // unit_price * quantity and persists the derived value.
  it('computes and persists total_price/net_amount when the caller omits them', async () => {
    const fixture = await createFixture();

    const rows = await createLineItems(fixture, [
      {
        description: 'Managed workstation',
        quantity: 3,
        unit_price: 2500,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(3);
    expect(Number(rows[0].unit_price)).toBe(2500);
    expect(Number(rows[0].total_price)).toBe(7500);
    expect(Number(rows[0].net_amount)).toBe(7500);
  });

  // Regression: `quantity || 1` silently rewrote a valid zero quantity to 1.
  // Zero must persist as zero, with zero derived amounts.
  it('persists a zero quantity as zero instead of coercing it to 1', async () => {
    const fixture = await createFixture();

    const rows = await createLineItems(fixture, [
      {
        description: 'Zero-usage metered service',
        quantity: 0,
        unit_price: 2500,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(0);
    expect(Number(rows[0].total_price)).toBe(0);
    expect(Number(rows[0].net_amount)).toBe(0);
  });

  it('honors caller-supplied net_amount over the derived value', async () => {
    const fixture = await createFixture();

    const rows = await createLineItems(fixture, [
      {
        description: 'Discounted line',
        quantity: 2,
        unit_price: 1000,
        total_price: 2000,
        net_amount: 1500,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total_price)).toBe(2000);
    expect(Number(rows[0].net_amount)).toBe(1500);
  });
});
