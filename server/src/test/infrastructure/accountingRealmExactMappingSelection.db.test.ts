import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { AccountingExportInvoiceSelector } from '@alga-psa/billing/services/accountingExportInvoiceSelector';
import { KnexCompanyMappingRepository } from '@alga-psa/billing/services/companySync/companyMappingRepository';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

/**
 * Realm-exact mapping selection (DB-backed).
 *
 * Two simulated QuickBooks companies (realm-a / realm-b) plus legacy
 * realm-less rows. Every assertion is behavioral — which invoices are
 * selectable for export to a realm, and which external company a
 * realm-scoped lookup resolves — never about generated SQL.
 */

const ADAPTER = 'quickbooks_online';
const REALM_A = 'realm-a';
const REALM_B = 'realm-b';

let db: Knex;
let tenantId: string;
let clientId: string;

const invoiceIds = {
  syncedRealmA: '',
  legacyRealmless: '',
  unmapped: '',
  syncedRealmB: ''
};

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function insertInvoice(label: string): Promise<string> {
  const invoiceId = randomUUID();
  const now = new Date().toISOString();
  await table('invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantId,
    client_id: clientId,
    invoice_number: `RLM-${label}-${invoiceId.slice(0, 8)}`,
    invoice_date: now,
    due_date: now,
    subtotal: 5000,
    tax: 0,
    total_amount: 5000,
    status: 'sent',
    currency_code: 'USD',
    billing_period_start: now,
    billing_period_end: now,
    is_manual: true,
    created_at: now,
    updated_at: now
  });
  await table('invoice_charges').insert({
    item_id: randomUUID(),
    tenant: tenantId,
    invoice_id: invoiceId,
    description: `Realm selection charge ${label}`,
    quantity: 1,
    unit_price: 5000,
    net_amount: 5000,
    total_price: 5000,
    tax_amount: 0,
    is_manual: true,
    created_at: now,
    updated_at: now
  });
  return invoiceId;
}

async function insertMapping(params: {
  entityType: string;
  entityId: string;
  externalId: string;
  realm: string | null;
}): Promise<void> {
  await table('tenant_external_entity_mappings').insert({
    id: randomUUID(),
    tenant: tenantId,
    integration_type: ADAPTER,
    alga_entity_type: params.entityType,
    alga_entity_id: params.entityId,
    external_entity_id: params.externalId,
    external_realm_id: params.realm
  });
}

async function selectableInvoiceIds(filters: {
  targetRealm?: string | null;
  excludeSyncedInvoices?: boolean;
}): Promise<Set<string>> {
  const selector = new AccountingExportInvoiceSelector(db, tenantId);
  const lines = await selector.previewInvoiceLines({
    adapterType: ADAPTER,
    invoiceIds: Object.values(invoiceIds),
    ...filters
  });
  return new Set(lines.map((line) => line.invoiceId));
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  tenantId = randomUUID();
  clientId = randomUUID();
  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Realm Mapping Selection Test',
    email: `realm-mapping-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Realm Mapping Client ${clientId.slice(0, 8)}`,
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  invoiceIds.syncedRealmA = await insertInvoice('A');
  invoiceIds.legacyRealmless = await insertInvoice('L');
  invoiceIds.unmapped = await insertInvoice('U');
  invoiceIds.syncedRealmB = await insertInvoice('B');

  // Deliberately colliding external ids across realms: '9001' exists in both
  // simulated companies but refers to different remote documents.
  await insertMapping({
    entityType: 'invoice',
    entityId: invoiceIds.syncedRealmA,
    externalId: '9001',
    realm: REALM_A
  });
  await insertMapping({
    entityType: 'invoice',
    entityId: invoiceIds.syncedRealmB,
    externalId: '9001',
    realm: REALM_B
  });
  await insertMapping({
    entityType: 'invoice',
    entityId: invoiceIds.legacyRealmless,
    externalId: '9001',
    realm: null
  });
}, 300_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
});

describe('realm-exact export invoice selection (DB-backed)', () => {
  it('selects unmapped invoices and invoices synced only to other realms; excludes ones synced to the target realm', async () => {
    const selected = await selectableInvoiceIds({ targetRealm: REALM_A });

    expect(selected.has(invoiceIds.unmapped)).toBe(true);
    // A realm-b mapping says nothing about realm-a: still exportable there.
    expect(selected.has(invoiceIds.syncedRealmB)).toBe(true);
    // Already synced to realm-a: excluded.
    expect(selected.has(invoiceIds.syncedRealmA)).toBe(false);
  });

  it('quarantines invoices with legacy realm-less mappings from realm-scoped selection', async () => {
    const selected = await selectableInvoiceIds({ targetRealm: REALM_A });
    expect(selected.has(invoiceIds.legacyRealmless)).toBe(false);

    const selectedB = await selectableInvoiceIds({ targetRealm: REALM_B });
    expect(selectedB.has(invoiceIds.legacyRealmless)).toBe(false);
  });

  it('keeps the quarantine in force for deliberate re-exports', async () => {
    const selected = await selectableInvoiceIds({
      targetRealm: REALM_A,
      excludeSyncedInvoices: false
    });

    // Re-export deliberately re-selects the realm-a synced invoice…
    expect(selected.has(invoiceIds.syncedRealmA)).toBe(true);
    // …but an ambiguous realm-less mapping still blocks selection.
    expect(selected.has(invoiceIds.legacyRealmless)).toBe(false);
  });

  it('treats realm-less selection as its own scope: only realm-less mappings mark invoices as synced', async () => {
    const selected = await selectableInvoiceIds({ targetRealm: null });

    expect(selected.has(invoiceIds.legacyRealmless)).toBe(false);
    expect(selected.has(invoiceIds.syncedRealmA)).toBe(true);
    expect(selected.has(invoiceIds.unmapped)).toBe(true);
  });
});

describe('realm-exact company mapping lookup (DB-backed)', () => {
  const companyRealmScoped = randomUUID();
  const companyLegacy = randomUUID();
  const companyLegacyForUpsert = randomUUID();
  const companySingleRealm = randomUUID();

  beforeAll(async () => {
    // Same alga client mapped to different customers in each company.
    await insertMapping({
      entityType: 'client',
      entityId: companyRealmScoped,
      externalId: '105',
      realm: REALM_A
    });
    await insertMapping({
      entityType: 'client',
      entityId: companyRealmScoped,
      externalId: '205',
      realm: REALM_B
    });
    // Legacy realm-less mapping.
    await insertMapping({
      entityType: 'client',
      entityId: companyLegacy,
      externalId: '888',
      realm: null
    });
    await insertMapping({
      entityType: 'client',
      entityId: companyLegacyForUpsert,
      externalId: '889',
      realm: null
    });
    // Mapped in one realm only.
    await insertMapping({
      entityType: 'client',
      entityId: companySingleRealm,
      externalId: '300',
      realm: REALM_A
    });
  });

  function repo() {
    return new KnexCompanyMappingRepository(db);
  }

  function find(companyId: string, targetRealm: string | null) {
    return repo().findCompanyMapping({
      tenantId,
      adapterType: ADAPTER,
      companyId,
      targetRealm
    });
  }

  it('resolves the mapping belonging to the requested realm', async () => {
    await expect(find(companyRealmScoped, REALM_A)).resolves.toMatchObject({
      externalCompanyId: '105'
    });
    await expect(find(companyRealmScoped, REALM_B)).resolves.toMatchObject({
      externalCompanyId: '205'
    });
  });

  it('never resolves a legacy realm-less mapping for a realm-scoped lookup', async () => {
    await expect(find(companyLegacy, REALM_A)).resolves.toBeNull();
    await expect(find(companyLegacy, REALM_B)).resolves.toBeNull();
  });

  it('never resolves another realm’s mapping for a realm-scoped lookup', async () => {
    await expect(find(companySingleRealm, REALM_B)).resolves.toBeNull();
  });

  it('still resolves realm-less mappings for realm-less lookups', async () => {
    await expect(find(companyLegacy, null)).resolves.toMatchObject({
      externalCompanyId: '888'
    });
  });

  it('upserting a realm-scoped mapping leaves the legacy realm-less row untouched', async () => {
    await repo().upsertCompanyMapping({
      tenantId,
      adapterType: ADAPTER,
      algaCompanyId: companyLegacyForUpsert,
      externalCompanyId: '999',
      targetRealm: REALM_A
    });

    await expect(find(companyLegacyForUpsert, REALM_A)).resolves.toMatchObject({
      externalCompanyId: '999'
    });
    await expect(find(companyLegacyForUpsert, null)).resolves.toMatchObject({
      externalCompanyId: '889'
    });
  });
});
