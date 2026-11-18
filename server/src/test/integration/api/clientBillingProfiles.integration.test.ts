/**
 * GET /api/v1/clients/{id}/billing-profiles[/{profileId}] against a real database.
 *
 * The unit suite drives a recording fake query builder, so it cannot prove the SQL: not the
 * tenant-safe left joins to client_locations, not the column names, not the ordering. This suite
 * runs ClientService against Postgres/Citus and pins the one assertion that matters for security:
 * a profile belonging to another client is a 404 from the owning client, never a 403 and never data.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createUser } from '../../../../test-utils/testDataFactory';
import { ClientService } from '@/lib/api/services/ClientService';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'client_billing_profiles').del();
  await tenantTable(tenantId, 'client_locations').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

function serviceFor(tenantId: string): ClientService {
  const service = new ClientService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

describe('client billing profiles read API (real DB)', () => {
  beforeAll(async () => { db = await createTestDbConnection(); });
  afterAll(async () => {
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    await db.destroy();
  });

  it('lists and reads a clients profiles, and never leaks another clients profile', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    await tenantRows().insert({
      tenant: tenantId,
      client_name: `Profiles Tenant ${tenantId.slice(0, 8)}`,
      email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    });
    const userId = await createUser(db, tenantId);
    const context: any = { tenant: tenantId, userId };

    const clientA = uuidv4();
    const clientB = uuidv4();
    await tenantTable(tenantId, 'clients').insert([
      { tenant: tenantId, client_id: clientA, client_name: 'Alpha Client' },
      { tenant: tenantId, client_id: clientB, client_name: 'Beta Client' },
    ]);

    const locationId = uuidv4();
    await tenantTable(tenantId, 'client_locations').insert({
      location_id: locationId,
      tenant: tenantId,
      client_id: clientA,
      location_name: 'Alpha HQ',
      address_line1: '1 Main St',
      city: 'Springfield',
      country_code: 'US',
      country_name: 'United States',
      is_default: true,
    });

    const defaultProfile = uuidv4();
    const secondProfile = uuidv4();
    const inactiveProfile = uuidv4();
    const foreignProfile = uuidv4();
    await tenantTable(tenantId, 'client_billing_profiles').insert([
      {
        tenant: tenantId, billing_profile_id: defaultProfile, client_id: clientA, name: 'Main',
        is_default: true, is_system_managed_default: true, is_active: true,
        bill_to_location_id: locationId, payment_terms: 'net_30', billing_email: 'ap@alpha.test',
      },
      {
        tenant: tenantId, billing_profile_id: secondProfile, client_id: clientA, name: 'Zeta',
        is_default: false, is_active: true,
      },
      {
        tenant: tenantId, billing_profile_id: inactiveProfile, client_id: clientA, name: 'Aardvark (retired)',
        is_default: false, is_active: false,
      },
      {
        tenant: tenantId, billing_profile_id: foreignProfile, client_id: clientB, name: 'Beta Only',
        is_default: true, is_active: true,
      },
    ]);

    const service = serviceFor(tenantId);

    // list: default first, then by name, inactive included, nothing from the other client
    const listed = await service.listBillingProfiles(clientA, context);
    expect(listed.map((p) => p.billing_profile_id)).toEqual([defaultProfile, inactiveProfile, secondProfile]);
    expect(listed.some((p) => p.billing_profile_id === foreignProfile)).toBe(false);
    expect(listed.find((p) => p.billing_profile_id === inactiveProfile)!.is_active).toBe(false);

    // get: real columns, real left join, ids paired with display names
    const one = await service.getBillingProfile(clientA, defaultProfile, context);
    expect(one).toMatchObject({
      billing_profile_id: defaultProfile,
      client_id: clientA,
      name: 'Main',
      is_default: true,
      is_system_managed_default: true,
      bill_to_location_id: locationId,
      bill_to_location_name: 'Alpha HQ',
      billing_email: 'ap@alpha.test',
      payment_terms: 'net_30',
      billing_contact_id: null,
      billing_contact_name: null,
      invoice_template_id: null,
      invoice_template_name: null,
    });
    expect(typeof one.created_at).toBe('string');

    // a profile of another client is a 404 for this client, not a 403 and not data
    await expect(service.getBillingProfile(clientA, foreignProfile, context))
      .rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(service.getBillingProfile(clientA, uuidv4(), context))
      .rejects.toMatchObject({ name: 'NotFoundError' });
    // an unknown client is a 404 for the list, not an empty list
    await expect(service.listBillingProfiles(uuidv4(), context))
      .rejects.toMatchObject({ name: 'NotFoundError' });
    // and the owner can still read it
    const own = await service.getBillingProfile(clientB, foreignProfile, context);
    expect(own.name).toBe('Beta Only');
  });
});
