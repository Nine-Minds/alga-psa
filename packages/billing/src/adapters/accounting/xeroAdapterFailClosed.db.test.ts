import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from '../../actions/_dbTestUtils';
import { XeroAdapter } from './xeroAdapter';
import type { AccountingExportAdapterContext } from '@alga-psa/types';

/**
 * Xero fail-closed mapping consumption at the transform boundary, driven
 * against a Xero test double. The SQL realm/tombstone scoping itself is
 * covered DB-backed in syncMappingRealm.db.test.ts; this suite proves the
 * adapter refuses an export for a tombstoned mapping before the double's
 * createInvoices could ever be reached, and that a live realm-exact mapping
 * sails past the tombstone gate.
 */

const createInvoicesSpy = vi.hoisted(() => vi.fn());

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

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XeroClientService: {
    create: vi.fn(async () => ({ createInvoices: createInvoicesSpy })),
  },
}));

const tenantId = uuidv4();
const REALM = 'realm-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

let db: Knex;
let adapter: XeroAdapter;

function makeContext(): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: tenantId,
      batch_id: 'batch-xero',
      adapter_type: 'xero',
      target_realm: REALM,
      export_type: 'invoice',
      status: 'pending',
      queued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    lines: [{ document_id: 'inv-1', document_line_id: 'charge-1', line_id: 'line-1' }],
  } as AccountingExportAdapterContext;
}

function seedXeroInvoiceMapping(invoiceId: string, overrides: Record<string, unknown> = {}) {
  return db('tenant_external_entity_mappings').insert({
    tenant: tenantId,
    integration_type: 'xero',
    alga_entity_type: 'invoice',
    alga_entity_id: invoiceId,
    external_entity_id: uuidv4(),
    external_realm_id: REALM,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides,
  });
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  refs.knex = db;
  refs.tenant = tenantId;
  adapter = new XeroAdapter();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Xero Unlink Test',
    email: `xero-unlink-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
});

beforeEach(() => {
  createInvoicesSpy.mockReset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db('tenant_external_entity_mappings').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
  await db.destroy().catch(() => undefined);
});

async function spyOnLoaders(adapterInstance: XeroAdapter) {
  const s = vi.spyOn(adapterInstance as any, 'loadInvoices');
  vi.spyOn(adapterInstance as any, 'loadCharges').mockResolvedValue(new Map());
  vi.spyOn(adapterInstance as any, 'loadClients').mockResolvedValue({
    clients: new Map(),
    mappings: new Map(),
  });
  return s;
}

describe('XeroAdapter fail-closed mapping consumption', () => {
  it('a tombstoned mapping aborts transform before any remote call', async () => {
    const now = new Date().toISOString();
    await seedXeroInvoiceMapping('inv-1', { deleted_at: now, sync_status: 'unlinked', updated_at: now });

    const loadInvoicesSpy = await spyOnLoaders(adapter);
    loadInvoicesSpy.mockResolvedValue(new Map([['inv-1', {
      invoice_id: 'inv-1',
      invoice_number: 'INV-1',
      invoice_date: new Date(),
      client_id: null,
      currency_code: 'USD',
    }]]));

    await expect(adapter.transform(makeContext())).rejects.toMatchObject({
      code: 'XERO_EXPORT_UNLINKED_DOCUMENT',
      message: expect.stringContaining('Relink it or explicitly re-create it'),
    });

    // The double received no mutating call.
    expect(createInvoicesSpy).not.toHaveBeenCalled();

    await db('tenant_external_entity_mappings').where({ tenant: tenantId, alga_entity_id: 'inv-1' }).del();
  });

  it('a live realm-exact mapping passes the tombstone gate and proceeds', async () => {
    await seedXeroInvoiceMapping('inv-1', { deleted_at: null });

    const loadInvoicesSpy = await spyOnLoaders(adapter);
    loadInvoicesSpy.mockResolvedValue(new Map([['inv-1', {
      invoice_id: 'inv-1',
      invoice_number: 'INV-1',
      invoice_date: new Date(),
      client_id: null,
      currency_code: 'USD',
    }]]));

    // The mapping gate passes; transform then fails on the missing client —
    // i.e. NOT the unlink-suppression error, and still no remote create.
    await expect(adapter.transform(makeContext())).rejects.toMatchObject({
      code: 'XERO_CLIENT_MISSING',
    });
    expect(createInvoicesSpy).not.toHaveBeenCalled();

    await db('tenant_external_entity_mappings').where({ tenant: tenantId, alga_entity_id: 'inv-1' }).del();
  });
});
