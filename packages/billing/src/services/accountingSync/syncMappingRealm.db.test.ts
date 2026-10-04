import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from '../../actions/_dbTestUtils';
import { SyncMappingLedger } from './syncMappingLedger';
import { KnexInvoiceMappingRepository } from '../../repositories/invoiceMappingRepository';

type XeroConnectionIdentity = { connectionId: string; xeroTenantId: string };
const xeroConnectionsState = vi.hoisted(() => ({
  value: {
    'xero-conn-1': { connectionId: 'xero-conn-1', xeroTenantId: 'org-1' },
    'xero-conn-2': { connectionId: 'xero-conn-2', xeroTenantId: 'org-2' },
  } as Record<string, XeroConnectionIdentity>,
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: async () => xeroConnectionsState.value,
}));

// Load the migration under test via a computed path so Nx's static graph does
// not record a billing -> server project edge for a test-only fixture (mirrors
// standardTemplateI18n.test.ts). The `up`/`down` shape is asserted at load.
type MigrationModule = { up: (knex: Knex) => Promise<void> };
let migration: MigrationModule;

async function loadMigration(): Promise<MigrationModule> {
  const mod = await import(
    /* @vite-ignore */ path.resolve(
      __dirname,
      '../../../../../server/migrations/20260830120000_external_mapping_tombstone_and_realm_normalization.cjs'
    )
  );
  const up = (mod as any).up ?? (mod as any).default?.up;
  if (typeof up !== 'function') {
    throw new Error('external_mapping_tombstone_and_realm_normalization migration is missing an up() export');
  }
  return { up };
}

/**
 * Fail-closed mapping ledger + realm-normalization migration.
 *
 * These are DB-backed by design: the fail-closed rule is a SQL property
 * (exact tenant + provider + type + realm, tombstones excluded, no NULL-realm
 * fallback), so it is asserted against the real ledger against a real database,
 * and the migration's backfill is verified end to end on seeded legacy rows.
 */

const realmA = 'realm-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const realmB = 'realm-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const tenantA = uuidv4();
const tenantB = uuidv4();

let db: Knex;

async function seedTenant(tenantId: string): Promise<void> {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Mapping Test ${tenantId.slice(0, 8)}`,
    email: `mapping-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

function mappingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: db.raw('gen_random_uuid()'),
    tenant: tenantA,
    integration_type: 'quickbooks_online',
    alga_entity_type: 'invoice',
    alga_entity_id: uuidv4(),
    external_entity_id: uuidv4(),
    external_realm_id: realmA,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides,
  };
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  migration = await loadMigration();
  db = await createTestDbConnection();
  await seedTenant(tenantA);
  await seedTenant(tenantB);
});

afterAll(async () => {
  await db('tenant_external_entity_mappings')
    .where({ tenant: tenantA })
    .orWhere({ tenant: tenantB })
    .del();
  await db('tenant_settings').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('tenants').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db.destroy().catch(() => undefined);
});

describe('migration: realm normalization backfills legacy NULL-realm QBO rows', () => {
  beforeEach(async () => {
    await db('tenant_external_entity_mappings')
      .where({ tenant: tenantA })
      .orWhere({ tenant: tenantB })
      .del();
    await db('tenant_settings').where({ tenant: tenantA }).del();
  });

  it('writes tenant_settings.accountingSync.defaultRealm onto NULL-realm quickbooks_online rows only', async () => {
    await db('tenant_settings').insert({
      tenant: tenantA,
      settings: { accountingSync: { defaultRealm: realmA } },
    });

    const qboInvoiceId = uuidv4();
    const xeroInvoiceId = uuidv4();
    const liveRealmRow = mappingRow(); // already realm-scoped — must stay untouched
    const inserted = await db('tenant_external_entity_mappings')
      .insert([
        mappingRow({ alga_entity_id: qboInvoiceId, external_realm_id: null }),
        mappingRow({ alga_entity_id: xeroInvoiceId, integration_type: 'xero', external_realm_id: null }),
        liveRealmRow,
      ])
      .returning(['id', 'alga_entity_id']);

    const liveId = inserted.find((row) => row.alga_entity_id === liveRealmRow.alga_entity_id)?.id;

    await migration.up(db);

    const qboRow = await db('tenant_external_entity_mappings').where({ alga_entity_id: qboInvoiceId }).first();
    expect(qboRow.external_realm_id).toBe(realmA);
    const xeroRow = await db('tenant_external_entity_mappings').where({ alga_entity_id: xeroInvoiceId }).first();
    // defaultRealm is a QuickBooks realm id — never a valid Xero connection id.
    expect(xeroRow.external_realm_id).toBeNull();
    const untouched = await db('tenant_external_entity_mappings').where({ id: liveId }).first();
    expect(untouched.external_realm_id).toBe(realmA);
  });

  it('leaves rows untouched when the tenant has no default realm', async () => {
    const legacyId = uuidv4();
    await db('tenant_external_entity_mappings').insert(
      mappingRow({ alga_entity_id: legacyId, external_realm_id: null })
    );

    await migration.up(db);

    const row = await db('tenant_external_entity_mappings').where({ alga_entity_id: legacyId }).first();
    expect(row.external_realm_id).toBeNull();
  });
});

describe('SyncMappingLedger realm-scoped consumption', () => {
  let realmInvoiceId: string;
  let nullRealmInvoiceId: string;
  let otherRealmInvoiceId: string;
  let clientEntityId: string;

  beforeEach(async () => {
    await db('tenant_external_entity_mappings')
      .where({ tenant: tenantA })
      .orWhere({ tenant: tenantB })
      .del();

    realmInvoiceId = uuidv4();
    nullRealmInvoiceId = uuidv4();
    otherRealmInvoiceId = uuidv4();
    clientEntityId = uuidv4();

    await db('tenant_external_entity_mappings').insert([
      mappingRow({ alga_entity_id: realmInvoiceId, external_realm_id: realmA }),
      mappingRow({ alga_entity_id: nullRealmInvoiceId, external_realm_id: null }),
      mappingRow({ alga_entity_id: otherRealmInvoiceId, external_realm_id: realmB }),
      mappingRow({ alga_entity_id: clientEntityId, alga_entity_type: 'client' }),
      mappingRow({ tenant: tenantB, alga_entity_id: uuidv4(), external_realm_id: realmA }),
    ]);
  });

  it('exact realm match only — a NULL-realm row is never a stand-in for a connected realm', async () => {
    const ledger = new SyncMappingLedger(db, tenantA, 'quickbooks_online');

    const exact = await ledger.findByAlgaId('invoice', realmInvoiceId, realmA);
    expect(exact?.external_realm_id).toBe(realmA);

    // The legacy NULL-realm row is invisible to a realm-scoped consumer.
    expect(await ledger.findByAlgaId('invoice', nullRealmInvoiceId, realmA)).toBeUndefined();

    // Explicit null target matches realm-less rows only.
    const nullOnly = await ledger.findByAlgaId('invoice', nullRealmInvoiceId, null);
    expect(nullOnly?.external_realm_id).toBeNull();
    expect(await ledger.findByAlgaId('invoice', realmInvoiceId, null)).toBeUndefined();
  });

  it('wrong entity type never matches', async () => {
    const ledger = new SyncMappingLedger(db, tenantA, 'quickbooks_online');
    expect(await ledger.findByAlgaId('invoice', clientEntityId, realmA)).toBeUndefined();
    expect(await ledger.findByAlgaId('client', realmInvoiceId, realmA)).toBeUndefined();
  });

  it('cross-tenant rows are invisible', async () => {
    const otherTenantRow = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantB })
      .first();
    const ledgerA = new SyncMappingLedger(db, tenantA, 'quickbooks_online');
    const ledgerB = new SyncMappingLedger(db, tenantB, 'quickbooks_online');

    expect(await ledgerA.findByAlgaId('invoice', otherTenantRow.alga_entity_id, realmA)).toBeUndefined();
    // The row is reachable only through the owning tenant's ledger.
    expect(await ledgerB.findByAlgaId('invoice', otherTenantRow.alga_entity_id, realmA)).toBeDefined();
  });

  it('findNonConsumable surfaces tombstones and wrong-realm rows for an actionable abort', async () => {
    const ledger = new SyncMappingLedger(db, tenantA, 'quickbooks_online');

    // Wrong realm: live row in realmB is non-consumable for realmA.
    const wrongRealm = await ledger.findNonConsumable('invoice', otherRealmInvoiceId, realmA);
    expect(wrongRealm?.external_realm_id).toBe(realmB);

    // NULL-realm legacy row is also non-consumable for a realm target.
    expect(await ledger.findNonConsumable('invoice', nullRealmInvoiceId, realmA)).toBeDefined();

    // Tombstoned row is non-consumable.
    const now = new Date().toISOString();
    await db('tenant_external_entity_mappings')
      .where({ id: (await db('tenant_external_entity_mappings').where({ alga_entity_id: realmInvoiceId }).first()).id })
      .update({ deleted_at: now, sync_status: 'unlinked', updated_at: now });
    expect(await ledger.findByAlgaId('invoice', realmInvoiceId, realmA)).toBeUndefined();
    expect(await ledger.findNonConsumable('invoice', realmInvoiceId, realmA)).toBeDefined();
  });
});

describe('unlink-then-export suppression and explicit relink', () => {
  let invoiceId: string;
  let mappingId: string;

  beforeEach(async () => {
    await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
    invoiceId = uuidv4();
    const row = mappingRow({ alga_entity_id: invoiceId, external_realm_id: realmA });
    const [inserted] = await db('tenant_external_entity_mappings').insert(row).returning('id');
    mappingId = inserted.id;
  });

  it('a tombstoned mapping is invisible to the export repository lookup but visible to the unlinked probe', async () => {
    const repo = new KnexInvoiceMappingRepository(db);
    const now = new Date().toISOString();
    await db('tenant_external_entity_mappings')
      .where({ id: mappingId })
      .update({ deleted_at: now, sync_status: 'unlinked', updated_at: now });

    const found = await repo.findInvoiceMapping({
      tenantId: tenantA,
      adapterType: 'quickbooks_online',
      invoiceId,
      targetRealm: realmA,
    });
    expect(found).toBeNull();

    const unlinked = await repo.findUnlinkedInvoiceMapping({
      tenantId: tenantA,
      adapterType: 'quickbooks_online',
      invoiceId,
      targetRealm: realmA,
    });
    expect(unlinked?.externalInvoiceId).toBeTruthy();
  });

  it('relinking through the vetted ledger restores the tombstone in place instead of duplicating it', async () => {
    const ledger = new SyncMappingLedger(db, tenantA, 'quickbooks_online');
    const now = new Date().toISOString();
    await db('tenant_external_entity_mappings')
      .where({ id: mappingId })
      .update({ deleted_at: now, sync_status: 'unlinked', updated_at: now });

    const newExternalId = uuidv4();
    const relinked = await ledger.insert({
      algaEntityType: 'invoice',
      algaEntityId: invoiceId,
      externalEntityId: newExternalId,
      targetRealm: realmA,
      syncStatus: 'synced',
    });

    expect(relinked.id).toBe(mappingId);
    expect(relinked.external_entity_id).toBe(newExternalId);
    expect(relinked.deleted_at).toBeNull();

    // Exactly one live row for the entity — no duplicate remote pointer.
    const rows = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantA, alga_entity_type: 'invoice', alga_entity_id: invoiceId })
      .whereNull('deleted_at');
    expect(rows).toHaveLength(1);
  });
});

describe('Xero connection-id identity with historical organisation-keyed mappings', () => {
  function xeroRow(overrides: Record<string, unknown>): Record<string, unknown> {
    return mappingRow({
      integration_type: 'xero',
      external_realm_id: 'xero-conn-1',
      ...overrides,
    });
  }

  beforeEach(async () => {
    await db('tenant_external_entity_mappings')
      .where({ tenant: tenantA })
      .orWhere({ tenant: tenantB })
      .del();
    xeroConnectionsState.value = {
      'xero-conn-1': { connectionId: 'xero-conn-1', xeroTenantId: 'org-1' },
      'xero-conn-2': { connectionId: 'xero-conn-2', xeroTenantId: 'org-2' },
    };
  });

  it('resolves a historical organisation-keyed mapping for its owning connection', async () => {
    const invoiceId = uuidv4();
    await db('tenant_external_entity_mappings').insert(
      xeroRow({ alga_entity_id: invoiceId, external_realm_id: 'org-1' })
    );

    const ledger = new SyncMappingLedger(db, tenantA, 'xero');
    const resolved = await ledger.findByAlgaId('invoice', invoiceId, 'xero-conn-1');
    expect(resolved?.external_realm_id).toBe('org-1');

    // The organisation alias is not the connection's own key: the exact
    // organisation-id target also resolves via its owning connection id.
    const byOrg = await ledger.findByAlgaId('invoice', invoiceId, 'org-1');
    expect(byOrg?.external_realm_id).toBe('org-1');
  });

  it('never resolves another organisation or tenant through the alias', async () => {
    const invoiceId = uuidv4();
    await db('tenant_external_entity_mappings').insert([
      xeroRow({ alga_entity_id: invoiceId, external_realm_id: 'org-2' }),
      xeroRow({ tenant: tenantB, alga_entity_id: invoiceId, external_realm_id: 'org-1' }),
    ]);

    const ledgerA = new SyncMappingLedger(db, tenantA, 'xero');
    // org-2 is owned by a different connection: invisible to xero-conn-1.
    expect(await ledgerA.findByAlgaId('invoice', invoiceId, 'xero-conn-1')).toBeUndefined();
    // The wrong-organisation row surfaces as non-consumable for an actionable abort.
    const blocked = await ledgerA.findNonConsumable('invoice', invoiceId, 'xero-conn-1');
    expect(blocked?.external_realm_id).toBe('org-2');

    // Cross-tenant org-1 rows stay invisible even though the realm id matches.
    const ledgerB = new SyncMappingLedger(db, tenantB, 'xero');
    expect(await ledgerB.findByAlgaId('invoice', invoiceId, 'xero-conn-2')).toBeUndefined();
    expect(await ledgerB.findByAlgaId('invoice', invoiceId, 'xero-conn-1')).toBeDefined();
  });

  it('prefers the exact connection-id mapping over a conflicting organisation-keyed row', async () => {
    const invoiceId = uuidv4();
    await db('tenant_external_entity_mappings').insert([
      xeroRow({ alga_entity_id: invoiceId, external_realm_id: 'org-1', external_entity_id: 'historical' }),
      xeroRow({ alga_entity_id: invoiceId, external_realm_id: 'xero-conn-1', external_entity_id: 'canonical' }),
    ]);

    const ledger = new SyncMappingLedger(db, tenantA, 'xero');
    const resolved = await ledger.findByAlgaId('invoice', invoiceId, 'xero-conn-1');
    expect(resolved?.external_realm_id).toBe('xero-conn-1');
    expect(resolved?.external_entity_id).toBe('canonical');
  });

  it('fails closed when the organisation is owned by more than one connection', async () => {
    xeroConnectionsState.value = {
      'xero-conn-1': { connectionId: 'xero-conn-1', xeroTenantId: 'org-shared' },
      'xero-conn-2': { connectionId: 'xero-conn-2', xeroTenantId: 'org-shared' },
    };
    const invoiceId = uuidv4();
    await db('tenant_external_entity_mappings').insert(
      xeroRow({ alga_entity_id: invoiceId, external_realm_id: 'org-shared' })
    );

    const ledger = new SyncMappingLedger(db, tenantA, 'xero');
    expect(await ledger.findByAlgaId('invoice', invoiceId, 'xero-conn-1')).toBeUndefined();
  });

  it('the invoice export repository resolves a historical organisation-keyed invoice mapping', async () => {
    const invoiceId = uuidv4();
    await db('tenant_external_entity_mappings').insert(
      xeroRow({ alga_entity_id: invoiceId, external_realm_id: 'org-1', external_entity_id: 'xero-inv-1' })
    );

    const repo = new KnexInvoiceMappingRepository(db);
    const found = await repo.findInvoiceMapping({
      tenantId: tenantA,
      adapterType: 'xero',
      invoiceId,
      targetRealm: 'xero-conn-1',
    });
    expect(found?.externalInvoiceId).toBe('xero-inv-1');
  });
});
