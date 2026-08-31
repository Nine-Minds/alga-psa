import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from '../../actions/_dbTestUtils';
import { QuickBooksOnlineAdapter } from './quickBooksOnlineAdapter';
import type {
  AccountingExportAdapterContext,
  AccountingExportTransformResult,
} from '@alga-psa/types';

/**
 * Adapter-level unlink-then-export suppression.
 *
 * The SQL scoping (exact realm, tombstones excluded) is covered DB-backed in
 * syncMappingRealm.db.test.ts; this suite drives the actual QBO adapter export
 * path (`deliver` → `deliverInvoiceDocument`) so the fail-closed *behavior* is
 * asserted: a tombstoned mapping produces an actionable delivery failure and
 * the remote company receives no create/update call.
 */

const qboCreate = vi.hoisted(() => vi.fn());
const qboUpdate = vi.hoisted(() => vi.fn());
const qboRead = vi.hoisted(() => vi.fn());

const refs = vi.hoisted(() => ({
  knex: null as any,
  tenant: '' as string,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: refs.knex, tenant: refs.tenant })),
    withTransaction: vi.fn(async (knex: Knex, callback: (trx: Knex) => Promise<unknown>) =>
      callback(knex)
    ),
  };
});

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn(async () => ({ create: qboCreate, update: qboUpdate, read: qboRead })),
  },
  getDefaultQboRealmId: vi.fn(async () => 'realm-unlinked'),
}));

const tenantId = uuidv4();
const REALM = 'realm-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

let db: Knex;
let adapter: QuickBooksOnlineAdapter;

function mappingRow(invoiceId: string, overrides: Record<string, unknown> = {}) {
  return {
    tenant: tenantId,
    integration_type: 'quickbooks_online',
    alga_entity_type: 'invoice',
    alga_entity_id: invoiceId,
    external_entity_id: uuidv4(),
    external_realm_id: REALM,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides,
  };
}

function makeTransformResult(invoiceId: string, externalId?: string): AccountingExportTransformResult {
  return {
    documents: [
      {
        documentId: invoiceId,
        lineIds: ['line-1'],
        payload: {
          documentType: 'Invoice',
          invoice: { DocNumber: 'INV-1' },
          chargeIds: ['charge-1'],
        } as unknown as Record<string, unknown>,
      },
    ],
    metadata: { adapter: 'quickbooks_online' },
  };
}

function makeContext(): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: tenantId,
      batch_id: 'batch-1',
      adapter_type: 'quickbooks_online',
      target_realm: REALM,
      export_type: 'invoice',
      status: 'pending',
      queued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    lines: [],
  } as AccountingExportAdapterContext;
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  refs.knex = db;
  refs.tenant = tenantId;
  adapter = new QuickBooksOnlineAdapter();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Unlink Export Test',
    email: `unlink-export-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
});

beforeEach(() => {
  qboCreate.mockReset();
  qboUpdate.mockReset();
  qboRead.mockReset();
});

afterAll(async () => {
  await db('tenant_external_entity_mappings').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
  await db.destroy().catch(() => undefined);
});

describe('QuickBooksOnlineAdapter unlink-then-export suppression', () => {
  it('a tombstoned mapping refuses export with an actionable failure and no remote call', async () => {
    const invoiceId = uuidv4();
    const now = new Date().toISOString();
    await db('tenant_external_entity_mappings').insert(
      mappingRow(invoiceId, { deleted_at: now, sync_status: 'unlinked', updated_at: now })
    );

    const result = await adapter.deliver(makeTransformResult(invoiceId), makeContext());

    expect(result.deliveredLines).toHaveLength(0);
    expect(result.failedDocuments).toBeDefined();
    expect(result.failedDocuments![0].code).toBe('QBO_EXPORT_UNLINKED_DOCUMENT');
    expect(result.failedDocuments![0].message).toContain('Relink it or explicitly re-create it');

    // The remote company was never touched — no create, no update.
    expect(qboCreate).not.toHaveBeenCalled();
    expect(qboUpdate).not.toHaveBeenCalled();

    // The tombstone is intact — a later export still has the suppression story.
    const row = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantId, alga_entity_id: invoiceId })
      .first();
    expect(row.deleted_at).not.toBeNull();
    expect(row.sync_status).toBe('unlinked');

    await db('tenant_external_entity_mappings').where({ tenant: tenantId, alga_entity_id: invoiceId }).del();
  });

  it('relinking the tombstone lets export proceed against the real remote document', async () => {
    const invoiceId = uuidv4();
    const externalId = 'qbo-inv-relinked';
    const now = new Date().toISOString();
    const [inserted] = await db('tenant_external_entity_mappings')
      .insert(mappingRow(invoiceId, { external_entity_id: externalId, deleted_at: now, sync_status: 'unlinked', updated_at: now }))
      .returning('id');

    // Explicit relink: the mapping screen / vetted ledger clears the tombstone.
    await db('tenant_external_entity_mappings')
      .where({ id: inserted.id })
      .update({ deleted_at: null, sync_status: 'synced', updated_at: now });

    qboRead.mockResolvedValue({ Id: externalId, SyncToken: '0' });
    qboUpdate.mockResolvedValue({
      Id: externalId,
      SyncToken: '1',
      TotalAmt: 100,
      DocNumber: 'INV-1',
      Line: [],
    });

    const result = await adapter.deliver(makeTransformResult(invoiceId), makeContext());

    expect(result.failedDocuments).toBeUndefined();
    expect(result.deliveredLines).toHaveLength(1);
    expect(qboUpdate).toHaveBeenCalledWith('Invoice', expect.objectContaining({ Id: externalId }));
    expect(qboCreate).not.toHaveBeenCalled();

    // The mapping is live again and still points at the same realm/document.
    const row = await db('tenant_external_entity_mappings')
      .where({ id: inserted.id })
      .first();
    expect(row.deleted_at).toBeNull();
    expect(row.external_entity_id).toBe(externalId);
    expect(row.external_realm_id).toBe(REALM);

    await db('tenant_external_entity_mappings').where({ id: inserted.id }).del();
  });

  it('an invoice that was never exported still exports normally (create path)', async () => {
    const invoiceId = uuidv4();
    qboCreate.mockResolvedValue({
      Id: 'qbo-inv-new',
      SyncToken: '0',
      TotalAmt: 100,
      DocNumber: 'INV-NEW',
      Line: [],
    });

    const result = await adapter.deliver(makeTransformResult(invoiceId), makeContext());

    expect(result.failedDocuments).toBeUndefined();
    expect(result.deliveredLines).toHaveLength(1);
    expect(qboCreate).toHaveBeenCalledWith('Invoice', expect.objectContaining({ DocNumber: 'INV-1' }));

    await db('tenant_external_entity_mappings').where({ tenant: tenantId, alga_entity_id: invoiceId }).del();
  });
});
