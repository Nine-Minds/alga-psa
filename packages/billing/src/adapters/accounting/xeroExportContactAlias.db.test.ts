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
 * DB-backed proof that Xero export client→contact resolution honours the
 * connection-id/organisation-id alias.
 *
 * An export batch targets the canonical connection id, but a contact mapping
 * created before that identity was unified persists the organisation id. The
 * export must reuse that historical mapping (so the invoice carries the mapped
 * ContactID) instead of creating a duplicate Xero contact named after the Alga
 * client. This mirrors the resolver's catalog lookup and the alias is fail-
 * closed: a mapping owned by a different organisation must never resolve.
 */

const connectionsState = vi.hoisted(() => ({
  value: {} as Record<string, { connectionId: string; xeroTenantId: string }>,
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: vi.fn(async () => connectionsState.value),
  XeroClientService: { create: vi.fn() },
}));

const tenantId = uuidv4();
const CONN_REVIEW = 'conn-review';
const ORG_REVIEW = 'org-review';
const CONN_OTHER = 'conn-other';
const ORG_OTHER = 'org-other';
const CLIENT_ID = uuidv4();

let db: Knex;
let adapter: XeroAdapter;

function makeContext(targetRealm: string): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: tenantId,
      batch_id: 'batch-alias',
      adapter_type: 'xero',
      target_realm: targetRealm,
      export_type: 'invoice',
      status: 'pending',
      queued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    lines: [{ document_id: 'inv-1', document_line_id: 'charge-1', line_id: 'line-1', client_id: CLIENT_ID }],
  } as AccountingExportAdapterContext;
}

const invoices = new Map<string, any>([
  ['inv-1', { invoice_id: 'inv-1', invoice_number: 'INV-1', client_id: CLIENT_ID, currency_code: 'USD' }],
]);

function seedClientMapping(externalContactId: string, externalRealmId: string | null) {
  return db('tenant_external_entity_mappings').insert({
    tenant: tenantId,
    integration_type: 'xero',
    alga_entity_type: 'client',
    alga_entity_id: CLIENT_ID,
    external_entity_id: externalContactId,
    external_realm_id: externalRealmId,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function loadClientMappings(targetRealm: string) {
  const result = await (adapter as any).loadClients(db, tenantId, makeContext(targetRealm), invoices);
  return result.mappings as Map<string, { external_entity_id: string; external_realm_id?: string | null }>;
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  adapter = new XeroAdapter();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Xero Contact Alias Test',
    email: `xero-alias-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
});

beforeEach(async () => {
  connectionsState.value = {
    [CONN_REVIEW]: { connectionId: CONN_REVIEW, xeroTenantId: ORG_REVIEW },
    [CONN_OTHER]: { connectionId: CONN_OTHER, xeroTenantId: ORG_OTHER },
  };
  await db('tenant_external_entity_mappings').where({ tenant: tenantId }).del();
});

afterAll(async () => {
  await db('tenant_external_entity_mappings').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
  await db.destroy().catch(() => undefined);
});

describe('XeroAdapter export client-contact alias resolution', () => {
  it('resolves a historical organisation-id contact mapping when the batch targets the connection id', async () => {
    await seedClientMapping('contact-historical', ORG_REVIEW);

    const mappings = await loadClientMappings(CONN_REVIEW);

    expect(mappings.get(CLIENT_ID)?.external_entity_id).toBe('contact-historical');
  });

  it('prefers the canonical connection-id mapping over the historical organisation alias', async () => {
    await seedClientMapping('contact-org-alias', ORG_REVIEW);
    await seedClientMapping('contact-canonical', CONN_REVIEW);

    const mappings = await loadClientMappings(CONN_REVIEW);

    expect(mappings.get(CLIENT_ID)?.external_entity_id).toBe('contact-canonical');
    expect(mappings.get(CLIENT_ID)?.external_realm_id).toBe(CONN_REVIEW);
  });

  it('never resolves a contact mapping owned by a different organisation', async () => {
    await seedClientMapping('contact-foreign', ORG_OTHER);

    const mappings = await loadClientMappings(CONN_REVIEW);

    expect(mappings.has(CLIENT_ID)).toBe(false);
  });
});
