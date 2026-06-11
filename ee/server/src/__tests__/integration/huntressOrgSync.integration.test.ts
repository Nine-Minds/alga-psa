import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { syncHuntressOrganizations } from '@ee/lib/integrations/huntress/organizations/orgSync';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantId = uuidv4();
const integrationId = uuidv4();
const acmeClientId = uuidv4();

const stubClient = {
  listOrganizations: async () => [
    { id: 1, name: 'Acme, Inc.' },   // exact normalized match → auto-link
    { id: 2, name: 'Globex' },       // ambiguous (two Globex clients) → stay unmapped
    { id: 3, name: 'Initech' },      // no match → stay unmapped
  ],
};

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  const hasCompanyName = await db.schema.hasColumn('tenants', 'company_name');
  await db('tenants').insert({
    tenant: tenantId,
    ...(hasCompanyName
      ? { company_name: 'OrgSync Test Tenant' }
      : { client_name: 'OrgSync Test Tenant' }),
    email: `orgsync-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('clients').insert(
    [
      { id: acmeClientId, name: 'ACME Inc' },
      { id: uuidv4(), name: 'Globex' },
      { id: uuidv4(), name: 'globex' },
    ].map((c) => ({
      tenant: tenantId,
      client_id: c.id,
      client_name: c.name,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }))
  );

  await db('rmm_integrations').insert({
    tenant: tenantId,
    integration_id: integrationId,
    provider: 'huntress',
    is_active: true,
    settings: JSON.stringify({}),
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (!db) return;
  for (const table of ['rmm_organization_mappings', 'rmm_integrations', 'clients', 'tenants']) {
    await db(table).where({ tenant: tenantId }).del().catch(() => undefined);
  }
  await db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

// The re-sync scenario builds on the rows created by the first test, so opt
// this suite out of the config-level test shuffling.
describe('syncHuntressOrganizations (DB integration)', { shuffle: false }, () => {
  it('creates mapping rows and auto-links exact normalized name matches', async () => {
    const result = await syncHuntressOrganizations(db, tenantId, integrationId, stubClient);
    expect(result.created).toBe(3);
    expect(result.autoMatched).toBe(1);

    const rows = await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId })
      .orderBy('external_organization_id');

    expect(rows).toHaveLength(3);

    const acme = rows.find((r: any) => r.external_organization_id === '1');
    expect(acme.client_id).toBe(acmeClientId);
    const acmeMeta = typeof acme.metadata === 'string' ? JSON.parse(acme.metadata) : acme.metadata;
    expect(acmeMeta.auto_matched).toBe(true);

    const globex = rows.find((r: any) => r.external_organization_id === '2');
    expect(globex.client_id).toBeNull();

    const initech = rows.find((r: any) => r.external_organization_id === '3');
    expect(initech.client_id).toBeNull();
    expect(initech.auto_create_tickets).toBe(true);
  });

  it('updates names on re-sync without touching manual mappings', async () => {
    // Simulate a manual mapping the user made, plus a renamed org in Huntress.
    const manualClient = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: manualClient,
      client_name: 'Manually Mapped',
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '3' })
      .update({ client_id: manualClient });

    const renamingClient = {
      listOrganizations: async () => [{ id: 3, name: 'Initech Renamed' }],
    };
    const result = await syncHuntressOrganizations(db, tenantId, integrationId, renamingClient);
    expect(result.updated).toBe(1);

    const row = await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '3' })
      .first();
    expect(row.external_organization_name).toBe('Initech Renamed');
    expect(row.client_id).toBe(manualClient); // manual mapping preserved
  });
});
