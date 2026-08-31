import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import '../../../../test-utils/nextApiMock';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

/**
 * Real-concurrency regression for the invoice-void vs invoice-export mapping
 * race. The void transaction re-reads tenant_external_entity_mappings under its
 * invoice row lock, but a SELECT cannot lock a row that does not exist yet, so
 * a concurrent export could insert the mapping (and create the remote invoice)
 * after the void's re-check — leaving a cancelled local invoice with a live
 * remote copy and no void op enqueued.
 *
 * The fix: every path that creates an invoice mapping first takes the SAME
 * local invoice row lock (FOR UPDATE, first statement — see
 * invoiceExternalSyncLock.ts) and verifies the invoice is not cancelled before
 * inserting the mapping or touching the remote system. These tests drive both
 * interleavings with real concurrent transactions:
 *
 *   void-then-export: the export path locks the (now cancelled) invoice and is
 *   refused — no mapping, no remote invoice.
 *
 *   export-then-void: the void queues on the export's held invoice lock,
 *   re-reads the mapping under its own lock once the export commits, and
 *   enqueues the remote void.
 */

const testDbRef: { db: Knex | null } = { db: null };
let tenantId = '';
const userId = uuidv4();

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null,
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: testDbRef.db, tenant: tenantId })),
  };
});

vi.mock('@alga-psa/core/logger', () => {
  const noop = vi.fn();
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: vi.fn(() => logger),
  };
  return { default: logger };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(() =>
    Promise.resolve({
      user_id: 'void-export-concurrency-user',
      tenant: tenantId,
      username: 'mock-user',
      first_name: 'Mock',
      last_name: 'User',
      email: 'mock.user@example.com',
      user_type: 'internal',
      roles: [],
    })
  ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

// The actions under test check permissions via the '@alga-psa/auth/rbac'
// subpath — a distinct module id from '@alga-psa/auth', so it needs its own
// mock. Default allow; tests that need a denied remote-mutate flip it.
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

// resolveDefaultRealm resolves the target realm through the stored QBO
// connection; the void enqueue and the onboarding link both read it.
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: vi.fn(async () => 'realm-1'),
  getStoredQboCredentialsMap: vi.fn(async () => ({ 'realm-1': {} })),
}));

import { wireLocalTestDbEnv, createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createClient } from '../../../../test-utils/testDataFactory';
import { currentUserRef } from '../../../../test-utils/authModuleMock';
import { voidInvoice } from '@alga-psa/billing/actions/voidInvoiceActions';
import { bulkLinkHistoricalInvoices } from '@alga-psa/billing/actions/qboOnboardingActions';
import { lockInvoiceForExternalSync } from '@alga-psa/billing/lib/invoiceExternalSyncLock';
import { ACCOUNTING_EXPORT_INVOICE_CANCELLED } from '@alga-psa/billing/lib/invoiceExternalSyncLock';
import { createExternalEntityMapping, updateExternalEntityMapping } from '@alga-psa/integrations/actions/externalMappingActions';
import { isActionMessageError } from '@alga-psa/ui/lib/errorHandling';
import { hasPermission } from '@alga-psa/auth/rbac';

const permissionMock = vi.mocked(hasPermission);

const REMOTE_MUTATE_DENIAL =
  'Permission denied: voiding invoices while the accounting integration is connected requires the accounting remote-mutate permission.';

let db: Knex;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLockWaiters(count: number, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await db.raw(
      `SELECT count(*)::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'`
    );
    if (Number(result.rows?.[0]?.waiting ?? 0) >= count) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${count} lock waiter(s)`);
    }
    await sleep(100);
  }
}

async function seedClient(name: string): Promise<string> {
  return createClient(db, tenantId, name, {
    billing_cycle: 'monthly',
    is_tax_exempt: true,
  });
}

/** Finalized, sent, unmapped invoice with no payments or applied credit. */
async function seedFinalizedInvoice(clientId: string): Promise<string> {
  const invoiceId = uuidv4();
  const now = new Date().toISOString();
  await db('invoices').insert({
    tenant: tenantId,
    invoice_id: invoiceId,
    client_id: clientId,
    invoice_number: `VEC-${invoiceId.slice(0, 8)}`,
    invoice_date: now,
    due_date: now,
    subtotal: 5000,
    tax: 0,
    total_amount: 5000,
    status: 'sent',
    credit_applied: 0,
    currency_code: 'USD',
    is_manual: false,
    is_prepayment: false,
    invoice_type: 'standard',
    finalized_at: now,
  });
  return invoiceId;
}

async function mappingCount(invoiceId: string): Promise<number> {
  const rows = await db('tenant_external_entity_mappings')
    .where({
      tenant: tenantId,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId,
    })
    .select('id');
  return rows.length;
}

async function awaitVoidOps(invoiceId: string, timeoutMs = 10000): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db('accounting_sync_operations')
      .where({ tenant: tenantId, operation: 'void_invoice', alga_entity_id: invoiceId })
      .select('*');
    if (rows.length >= 1) return rows;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for a void_invoice op for ${invoiceId}`);
    }
    await sleep(100);
  }
}

describe('invoice void vs invoice export mapping — real concurrency', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    testDbRef.db = db;
    const tenantRow = await db('tenants').first('tenant');
    if (!tenantRow) {
      throw new Error('Seeded test database has no tenant');
    }
    tenantId = String(tenantRow.tenant);
    currentUserRef.user = { ...currentUserRef.user, tenant: tenantId, user_id: userId };

    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
  }, 240000);

  afterAll(async () => {
    await db?.destroy();
  }, 30000);

  beforeEach(() => {
    permissionMock.mockReset();
    permissionMock.mockImplementation(async (_user, resource, action) => {
      if (resource === 'accounting_integrations' && action === 'remote_mutate') return false;
      return true;
    });
  });

  it('void-then-export: the mapping insertion is refused for an already-cancelled invoice', async () => {
    // The permission gate is connection-based (this suite's tenant is
    // connected), so the void needs remote_mutate to proceed — this test is
    // about the serialize ordering, not the permission denial.
    permissionMock.mockImplementation(async () => true);

    const clientId = await seedClient('Void Then Export Client');
    const invoiceId = await seedFinalizedInvoice(clientId);

    const voidResult = await voidInvoice(invoiceId, 'void first');
    expect(voidResult).toEqual({ success: true });

    const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant: tenantId }).first();
    expect(invoice.status).toBe('cancelled');

    // The export path (bulkLinkHistoricalInvoices is one such site) must lock
    // the invoice row and verify it is not cancelled before inserting a
    // mapping. A cancelled invoice refuses instead of gaining a mapping — a
    // mapping here would leave the remote invoice outliving the cancelled
    // local document with no void op enqueued.
    await expect(
      bulkLinkHistoricalInvoices([
        {
          invoiceId,
          externalId: `QBO-INV-${invoiceId.slice(0, 8)}`,
          externalTotal: 500000,
          externalDocNumber: 'DOC-1',
          externalSyncToken: '1',
        },
      ])
    ).rejects.toMatchObject({ code: ACCOUNTING_EXPORT_INVOICE_CANCELLED });

    expect(await mappingCount(invoiceId)).toBe(0);
  }, 60000);

  it('export-then-void: a mapping inserted while the export holds the lock is seen by the void, which enqueues the remote void', async () => {
    // This interleaving requires the actor to hold remote_mutate, or the void
    // must refuse the now remote-affecting invoice entirely (test below).
    permissionMock.mockImplementation(async () => true);

    const clientId = await seedClient('Export Then Void Client');
    const invoiceId = await seedFinalizedInvoice(clientId);

    const exportHolder = await db.transaction();
    try {
      // Standing in for an in-flight export that has taken the shared invoice
      // row lock (the export's first statement) and not yet committed its
      // mapping: the void must queue behind this lock, not interleave with it.
      await lockInvoiceForExternalSync(exportHolder, tenantId, invoiceId);

      const voidPromise = voidInvoice(invoiceId, 'void during export');
      await waitForLockWaiters(1);

      // The export completes: it inserts the invoice mapping and commits,
      // releasing the lock. The void then re-reads the mapping under its own
      // lock, sees it, and — with remote_mutate + a realm — enqueues the
      // remote void rather than cancelling the invoice with no void op.
      await exportHolder('tenant_external_entity_mappings').insert({
        id: exportHolder.raw('gen_random_uuid()'),
        tenant: tenantId,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'invoice',
        alga_entity_id: invoiceId,
        external_entity_id: `QBO-INV-${invoiceId.slice(0, 8)}`,
        external_realm_id: 'realm-1',
        sync_status: 'synced',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await exportHolder.commit();

      const voidResult = await voidPromise;
      expect(voidResult).toEqual({ success: true });
    } catch (error) {
      if (!exportHolder.isCompleted()) await exportHolder.rollback();
      throw error;
    }

    const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant: tenantId }).first();
    expect(invoice.status).toBe('cancelled');
    expect(await mappingCount(invoiceId)).toBe(1);

    const ops = await awaitVoidOps(invoiceId);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      operation: 'void_invoice',
      adapter_type: 'quickbooks_online',
      target_realm: 'realm-1',
      alga_entity_type: 'invoice',
    });
    expect((ops[0].payload as Record<string, unknown>).requestedByUserId).toBe(userId);
  }, 60000);

  it('no-remote-mutate actor on the connected tenant is refused for an unmapped invoice — the denial is connection-based, not mapping-based', async () => {
    // This suite's tenant is connected (the file-level qbo mock serves a
    // realm), and the default permission mock denies remote_mutate. The void
    // must therefore be refused even though this invoice has no mapping at
    // all: the denial predicate reads connection state, never the per-invoice
    // mapping row, so a denial cannot be used to learn whether an invoice is
    // mapped.
    const clientId = await seedClient('Unmapped Connected Denial Client');
    const invoiceId = await seedFinalizedInvoice(clientId);

    const voidResult = await voidInvoice(invoiceId, 'unmapped connected void');
    expect(voidResult.success).toBe(false);
    expect(voidResult.error).toBe(REMOTE_MUTATE_DENIAL);

    const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant: tenantId }).first();
    expect(invoice.status).toBe('sent');
    expect(await mappingCount(invoiceId)).toBe(0);

    const ops = await db('accounting_sync_operations')
      .where({ tenant: tenantId, operation: 'void_invoice', alga_entity_id: invoiceId });
    expect(ops).toHaveLength(0);
  }, 60000);

  it('denies when remote_mutate is revoked between the fast-fail and the in-transaction re-check', async () => {
    // The fast-fail reads the capability against the pool connection; the
    // in-transaction re-check reads against the transaction. Grant at the pool
    // (the void proceeds), revoke under the transaction — the re-check must
    // catch the revocation even though a mapping lands while the void was
    // queued on the export's held invoice lock.
    permissionMock.mockImplementation(async (_user, resource, action, conn) => {
      if (resource === 'accounting_integrations' && action === 'remote_mutate') {
        return conn === db;
      }
      return true;
    });

    const clientId = await seedClient('Revoked Mid-Flight Client');
    const invoiceId = await seedFinalizedInvoice(clientId);

    const exportHolder = await db.transaction();
    try {
      await lockInvoiceForExternalSync(exportHolder, tenantId, invoiceId);
      const voidPromise = voidInvoice(invoiceId, 'revoked under lock');
      await waitForLockWaiters(1);

      await exportHolder('tenant_external_entity_mappings').insert({
        id: exportHolder.raw('gen_random_uuid()'),
        tenant: tenantId,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'invoice',
        alga_entity_id: invoiceId,
        external_entity_id: `QBO-INV-${invoiceId.slice(0, 8)}`,
        external_realm_id: 'realm-1',
        sync_status: 'synced',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await exportHolder.commit();

      const voidResult = await voidPromise;
      expect(voidResult.success).toBe(false);
      expect(voidResult.error).toBe(REMOTE_MUTATE_DENIAL);
    } catch (error) {
      if (!exportHolder.isCompleted()) await exportHolder.rollback();
      throw error;
    }

    const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant: tenantId }).first();
    expect(invoice.status).toBe('sent');
    expect(await mappingCount(invoiceId)).toBe(1);

    const ops = await db('accounting_sync_operations')
      .where({ tenant: tenantId, operation: 'void_invoice', alga_entity_id: invoiceId });
    expect(ops).toHaveLength(0);
  }, 60000);

  it('createExternalEntityMapping-vs-void: a void that commits first makes the mapping insertion refuse on the cancelled invoice', async () => {
    permissionMock.mockImplementation(async () => true);
    const clientId = await seedClient('Mapping After Void Client');
    const invoiceId = await seedFinalizedInvoice(clientId);

    const voidResult = await voidInvoice(invoiceId, 'void before mapping');
    expect(voidResult).toEqual({ success: true });

    // The generic mapping CRUD now holds the shared invoice lock before an
    // invoice-typed insert; on the cancelled invoice it refuses instead of
    // writing a mapping that would leave a live remote document behind.
    const result = await createExternalEntityMapping({
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId,
      external_entity_id: `QBO-INV-${invoiceId.slice(0, 8)}`,
      external_realm_id: 'realm-1',
    });
    expect(isActionMessageError(result)).toBe(true);
    expect((result as { actionError: string }).actionError).toContain('voided');
    expect(await mappingCount(invoiceId)).toBe(0);
  }, 60000);

  it('createExternalEntityMapping creates an invoice mapping the void then treats as remote-affecting', async () => {
    permissionMock.mockImplementation(async () => true);
    const clientId = await seedClient('Mapping Before Void Client');
    const invoiceId = await seedFinalizedInvoice(clientId);

    const created = await createExternalEntityMapping({
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId,
      external_entity_id: `QBO-INV-${invoiceId.slice(0, 8)}`,
      external_realm_id: 'realm-1',
    });
    expect(isActionMessageError(created)).toBe(false);
    expect((created as { id: string }).id).toBeTruthy();

    // The void re-reads the mapping under its invoice lock and enqueues the
    // remote void rather than cancelling locally with no void op.
    const voidResult = await voidInvoice(invoiceId, 'void after mapping');
    expect(voidResult).toEqual({ success: true });

    const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant: tenantId }).first();
    expect(invoice.status).toBe('cancelled');
    expect(await mappingCount(invoiceId)).toBe(1);

    const ops = await awaitVoidOps(invoiceId);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ operation: 'void_invoice', target_realm: 'realm-1' });
  }, 60000);

  it('updateExternalEntityMapping refuses to retarget an invoice mapping onto a cancelled invoice', async () => {
    permissionMock.mockImplementation(async () => true);
    const clientId = await seedClient('Mapping Retarget Client');
    const liveInvoiceId = await seedFinalizedInvoice(clientId);
    const cancelledInvoiceId = await seedFinalizedInvoice(clientId);

    const created = await createExternalEntityMapping({
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: liveInvoiceId,
      external_entity_id: 'QBO-LIVE-1',
      external_realm_id: 'realm-1',
    });
    expect((created as { id: string }).id).toBeTruthy();

    const voidResult = await voidInvoice(cancelledInvoiceId, 'void retarget target');
    expect(voidResult).toEqual({ success: true });

    // Retargeting which invoice the mapping points at concerns the old and the
    // new invoice; the lock refuses because the new one is cancelled.
    const result = await updateExternalEntityMapping((created as { id: string }).id, {
      alga_entity_id: cancelledInvoiceId,
    });
    expect(isActionMessageError(result)).toBe(true);
    expect((result as { actionError: string }).actionError).toContain('voided');

    const row = await db('tenant_external_entity_mappings')
      .where({ id: (created as { id: string }).id })
      .first();
    expect(row.alga_entity_id).toBe(liveInvoiceId);
  }, 60000);
});
