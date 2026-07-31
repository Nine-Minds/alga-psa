import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Customer-communicated contracts for QBO export safety.
 *
 * These came out of the July 2026 adversarial onboarding review with an
 * established-company-file customer profile, and are commitments about how
 * Alga treats books that were reconciled outside Alga:
 *
 *   1. A document posted to QBO stays posted: exported invoices can be voided
 *      (which propagates) but never unfinalized or hard-deleted from Alga.
 *   2. The go-live cutoff fences by the invoice's own date. Re-finalizing a
 *      pre-go-live invoice after the cutoff must NOT export it — neither as a
 *      duplicate of a hand-entered QBO document nor as an update to
 *      reconciled history.
 *   3. By default, nothing outside the onboarding wizard writes to the QBO
 *      customer list: customer auto-provisioning is opt-in
 *      (autoProvisionCustomers, default false), and with it off an unmapped
 *      customer fails export validation with an actionable exception.
 *
 * A failure here means a change to safety behavior customers were told they
 * can rely on — decide the rollout and comms before updating the test.
 */

// ── Module mocks (hoisted) ──────────────────────────────────────────────────
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: vi.fn(async () => ({})) },
  getDefaultQboRealmId: vi.fn(async () => 'realm-1'),
  getStoredQboCredentialsMap: vi.fn(async () => ({ 'realm-1': {} }))
}));

vi.mock('./syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(function () { return ({
    enqueue: vi.fn(async () => ({})),
    satisfyPending: vi.fn(async () => 1)
  }); })
}));

import { assertInvoiceNotExported } from './invoiceExportGuards';
import { enqueueInvoiceAutoExport } from './syncProducers';
import { getAccountingSyncSettings } from './accountingSyncSettings';
import { SyncOperationsRepository } from './syncOperationsRepository';

/** Multi-table fake knex so the producer runs through the REAL settings code. */
function makeKnex(tables: Record<string, any>) {
  const knex: any = vi.fn((table: string) => {
    if (!(table in tables)) {
      throw new Error(`unexpected table ${table}`);
    }
    const row = tables[table];
    // Self-referential builder so tenantDb(...).table(name).where(...) can
    // chain a second .where(...) (the applier's own filter) after the
    // auto-injected tenant clause.
    const query: any = {
      where: vi.fn(() => query),
      select: vi.fn(() => query),
      first: vi.fn(async () => row)
    };
    return query;
  });
  knex.fn = { now: vi.fn() };
  return knex;
}

function settingsRow(accountingSync: Record<string, unknown>) {
  return { settings: { accountingSync } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EDITION', 'ee');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Contract 1 ──────────────────────────────────────────────────────────────
describe('Contract 1 — a document posted to QBO stays posted', () => {
  it('unfinalize is blocked on an exported invoice, directing to void or credit note', async () => {
    const knex = makeKnex({ tenant_external_entity_mappings: { id: 'map-1' } });

    await expect(assertInvoiceNotExported(knex, 't1', 'inv-exported', 'unfinalize')).rejects.toThrow(
      /cannot be reopened/i
    );
  });

  it('hard delete is blocked on an exported invoice, directing to void', async () => {
    const knex = makeKnex({ tenant_external_entity_mappings: { id: 'map-1' } });

    await expect(assertInvoiceNotExported(knex, 't1', 'inv-exported', 'delete')).rejects.toThrow(
      /void it instead of deleting/i
    );
  });

  it('unexported invoices are unaffected', async () => {
    const knex = makeKnex({ tenant_external_entity_mappings: undefined });

    await expect(assertInvoiceNotExported(knex, 't1', 'inv-local', 'unfinalize')).resolves.toBeUndefined();
  });
});

// ── Contract 2 ──────────────────────────────────────────────────────────────
describe('Contract 2 — go-live cutoff fences by invoice date, not the wall clock', () => {
  it('a pre-go-live invoice re-finalized today does not enqueue an export', async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const historicalDate = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const knex = makeKnex({
      tenant_settings: settingsRow({ autoSyncEnabled: true, autoSyncStartDate: cutoff }),
      invoices: { invoice_type: 'standard', invoice_date: historicalDate }
    });

    await enqueueInvoiceAutoExport(knex, 't1', 'inv-2024-history');

    for (const result of vi.mocked(SyncOperationsRepository).mock.results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });

  it('an invoice dated after the cutoff enqueues normally', async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const knex = makeKnex({
      tenant_settings: settingsRow({ autoSyncEnabled: true, autoSyncStartDate: cutoff }),
      invoices: { invoice_type: 'standard', invoice_date: recentDate }
    });

    await enqueueInvoiceAutoExport(knex, 't1', 'inv-current');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(expect.objectContaining({ algaEntityId: 'inv-current' }));
  });
});

// ── Contract 3 ──────────────────────────────────────────────────────────────
describe('Contract 3 — customer auto-provisioning is opt-in', () => {
  it('autoProvisionCustomers defaults to FALSE for tenants that never set it', async () => {
    // Empty settings row: whatever a tenant had before this setting existed.
    const knex = makeKnex({ tenant_settings: undefined });

    const settings = await getAccountingSyncSettings(knex, 't1');

    expect(settings.autoProvisionCustomers).toBe(false);
  });

  it('legacy settings blobs without the field normalize to FALSE, not undefined', async () => {
    const knex = makeKnex({
      tenant_settings: settingsRow({ autoSyncEnabled: true, autoSyncStartDate: null })
    });

    const settings = await getAccountingSyncSettings(knex, 't1');

    expect(settings.autoProvisionCustomers).toBe(false);
  });
});
