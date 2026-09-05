import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';
import {
  BILLING_PROFILE_ENTITY_TYPE,
  CLIENT_ENTITY_TYPE,
  listSubCustomerProfiles,
  resolveInvoiceExportTarget,
  subCustomerDisplayName,
} from '@alga-psa/shared/billingClients/billingProfileExternalMapping';

/**
 * S11 — QuickBooks sub-customer mapping (T042).
 *
 * QuickBooks already models "one customer, several billed sub-entities" as a
 * parent customer with sub-customers, which is exactly the shape a segmented
 * client has. The value of the mapping is that a franchise site's invoices land
 * on its own ledger and its own statement while still rolling up to the
 * franchise — and the risk is the opposite: an invoice exported against the
 * parent puts the balance on the wrong entity, where nobody chasing it will
 * find it.
 *
 * The safety property, as everywhere else in this feature, is that a client
 * nobody has segmented exports as the plain customer it always has (F119).
 */

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantId: string;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedClient(name: string): Promise<string> {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return clientId;
}

async function markSeparatelyBilling(billingProfileId: string): Promise<void> {
  await table('client_billing_profiles')
    .where({ billing_profile_id: billingProfileId })
    .update({ bills_separately: true });
}

describe('billing profiles S11 — QuickBooks sub-customer mapping (T042)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'S11 Fixture',
        email: `s11-${tenantId.slice(0, 8)}@profiles.test`,
      });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('F119: a single-profile client has no sub-customers at all', async () => {
    const clientId = await seedClient('Plain Client');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);

    expect(await listSubCustomerProfiles(db, tenantId, clientId)).toEqual([]);

    // Even with its own profile stamped on the invoice, the export target is
    // the plain customer — exactly what it produced before this feature.
    const target = await resolveInvoiceExportTarget(
      db,
      tenantId,
      clientId,
      'Plain Client',
      defaultProfileId,
    );
    expect(target).toMatchObject({
      algaEntityType: CLIENT_ENTITY_TYPE,
      algaEntityId: clientId,
      displayName: 'Plain Client',
      isSubCustomer: false,
    });
  }, HOOK_TIMEOUT);

  it('F118: only a separately-billing, non-default profile becomes a sub-customer', async () => {
    const clientId = await seedClient('Franchise Group');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const billingSiteId = await createBillingProfile({ db, tenantId }, clientId, 'Site B');
    const reportingSegmentId = await createBillingProfile({ db, tenantId }, clientId, 'Marketing');
    await markSeparatelyBilling(billingSiteId);
    await markSeparatelyBilling(defaultProfileId);

    const subCustomers = await listSubCustomerProfiles(db, tenantId, clientId);
    // The default profile *is* the client in accounting terms, and a
    // reporting-only segment issues no invoice — a sub-customer for either
    // would be a record someone has to reconcile against nothing.
    expect(subCustomers.map((profile) => profile.billing_profile_id)).toEqual([billingSiteId]);
    expect(subCustomers.some((profile) => profile.billing_profile_id === reportingSegmentId)).toBe(false);
  }, HOOK_TIMEOUT);

  it('F121: an invoice exports against its own profile’s sub-customer', async () => {
    const clientId = await seedClient('Export Group');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site C');
    await markSeparatelyBilling(siteProfileId);

    const siteTarget = await resolveInvoiceExportTarget(
      db,
      tenantId,
      clientId,
      'Export Group',
      siteProfileId,
    );
    expect(siteTarget).toMatchObject({
      algaEntityType: BILLING_PROFILE_ENTITY_TYPE,
      algaEntityId: siteProfileId,
      clientId,
      isSubCustomer: true,
    });
    // Qualified by the parent because QuickBooks display names must be unique
    // across the whole file — a bare "Site C" collides with the next client's.
    expect(siteTarget.displayName).toBe(subCustomerDisplayName('Export Group', 'Site C'));

    // The parent's own invoices stay on the parent customer.
    const parentTarget = await resolveInvoiceExportTarget(
      db,
      tenantId,
      clientId,
      'Export Group',
      defaultProfileId,
    );
    expect(parentTarget.isSubCustomer).toBe(false);
    expect(parentTarget.algaEntityId).toBe(clientId);
  }, HOOK_TIMEOUT);

  it('F121: an invoice raised before profiles existed exports against the client', async () => {
    const clientId = await seedClient('Legacy Invoice Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site D');
    await markSeparatelyBilling(siteProfileId);

    const target = await resolveInvoiceExportTarget(
      db,
      tenantId,
      clientId,
      'Legacy Invoice Client',
      null,
    );
    expect(target.algaEntityType).toBe(CLIENT_ENTITY_TYPE);
    expect(target.isSubCustomer).toBe(false);
  }, HOOK_TIMEOUT);

  it('F116: client and profile mappings coexist in the one mapping table', async () => {
    const clientId = await seedClient('Mapping Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site E');
    await markSeparatelyBilling(siteProfileId);

    // The table is already keyed on (alga_entity_type, alga_entity_id), so a
    // profile-level mapping needs no schema change — only a second entity type.
    await table('tenant_external_entity_mappings').insert([
      {
        id: uuidv4(),
        tenant: tenantId,
        integration_type: 'quickbooks_online',
        alga_entity_type: CLIENT_ENTITY_TYPE,
        alga_entity_id: clientId,
        external_entity_id: 'QBO-100',
        external_realm_id: 'realm-1',
      },
      {
        id: uuidv4(),
        tenant: tenantId,
        integration_type: 'quickbooks_online',
        alga_entity_type: BILLING_PROFILE_ENTITY_TYPE,
        alga_entity_id: siteProfileId,
        external_entity_id: 'QBO-101',
        external_realm_id: 'realm-1',
      },
    ]);

    const rows = await table('tenant_external_entity_mappings')
      .whereIn('alga_entity_id', [clientId, siteProfileId])
      .select('alga_entity_type', 'external_entity_id')
      .orderBy('external_entity_id', 'asc');
    expect(rows).toEqual([
      { alga_entity_type: CLIENT_ENTITY_TYPE, external_entity_id: 'QBO-100' },
      { alga_entity_type: BILLING_PROFILE_ENTITY_TYPE, external_entity_id: 'QBO-101' },
    ]);
  }, HOOK_TIMEOUT);
});
