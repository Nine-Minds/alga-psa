import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';

/**
 * S6/S12 — portal segment views and their access control (T029, T030, T031, T043).
 *
 * Two properties matter here and both are about trust:
 *
 *   The parts sum to the whole. A manager who reads an organisation total and
 *   then the per-segment breakdown must not find a gap, because nothing on the
 *   screen would tell them which figure to believe.
 *
 *   Restriction is enforced where the data is read, not where it is displayed.
 *   A restricted user asking for another segment directly gets refused, and
 *   their "whole organisation" total is the whole of what they may see.
 */

let db: Knex;
let tenantId: string;
let portalUserId: string;
let portalContactId: string;

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getConnection: vi.fn(async () => db),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

const HOOK_TIMEOUT = 300_000;
const PERIOD_START = '2025-04-01';
const PERIOD_END = '2025-05-01';

let getPortalBillingProfiles: typeof import('@alga-psa/client-portal/actions/client-portal-actions/client-billing-segments')['getPortalBillingProfiles'];
let getPortalSpendByBillingProfile: typeof import('@alga-psa/client-portal/actions/client-portal-actions/client-billing-segments')['getPortalSpendByBillingProfile'];
let getPortalChargesForBillingProfile: typeof import('@alga-psa/client-portal/actions/client-portal-actions/client-billing-segments')['getPortalChargesForBillingProfile'];

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedFinalizedInvoice(
  clientId: string,
  invoiceDate: string,
  charges: Array<{ billingProfileId: string; net: number; tax: number; description: string }>,
): Promise<void> {
  const invoiceId = uuidv4();
  await table('invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantId,
    client_id: clientId,
    invoice_number: `PINV-${invoiceId.slice(0, 8)}`,
    invoice_date: invoiceDate,
    due_date: invoiceDate,
    status: 'sent',
    finalized_at: `${invoiceDate}T00:00:00Z`,
    subtotal: charges.reduce((sum, c) => sum + c.net, 0),
    tax: charges.reduce((sum, c) => sum + c.tax, 0),
    total_amount: charges.reduce((sum, c) => sum + c.net + c.tax, 0),
    credit_applied: 0,
    is_manual: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  for (const charge of charges) {
    await table('invoice_charges').insert({
      item_id: uuidv4(),
      tenant: tenantId,
      invoice_id: invoiceId,
      description: charge.description,
      quantity: 1,
      unit_price: charge.net,
      net_amount: charge.net,
      tax_amount: charge.tax,
      total_price: charge.net + charge.tax,
      is_manual: true,
      is_discount: false,
      is_taxable: charge.tax > 0,
      billing_profile_id: charge.billingProfileId,
      billing_profile_source: 'contract',
      created_at: db.fn.now(),
    });
  }
}

describe('billing profiles S6/S12 — portal segments (T029, T030, T031, T043)', () => {
  let segmentedClientId: string;
  let singleProfileClientId: string;
  let northProfileId: string;
  let southProfileId: string;
  let corporateProfileId: string;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'Portal Segments Fixture',
        email: `portalseg-${tenantId.slice(0, 8)}@profiles.test`,
      });

    segmentedClientId = uuidv4();
    singleProfileClientId = uuidv4();
    await table('clients').insert([
      {
        tenant: tenantId,
        client_id: segmentedClientId,
        client_name: 'Multi-Entity Group',
        billing_cycle: 'monthly',
        default_currency_code: 'USD',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        tenant: tenantId,
        client_id: singleProfileClientId,
        client_name: 'Ordinary Client',
        billing_cycle: 'monthly',
        default_currency_code: 'USD',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ]);

    corporateProfileId = await ensureDefaultBillingProfile({ db, tenantId }, segmentedClientId, {
      name: 'Corporate',
    });
    northProfileId = await createBillingProfile({ db, tenantId }, segmentedClientId, 'North Entity');
    southProfileId = await createBillingProfile({ db, tenantId }, segmentedClientId, 'South Entity');
    await ensureDefaultBillingProfile({ db, tenantId }, singleProfileClientId, {
      name: 'Ordinary Client',
    });

    // A portal user is a contact of the client with a user row.
    portalContactId = uuidv4();
    await table('contacts').insert({
      contact_name_id: portalContactId,
      tenant: tenantId,
      full_name: 'Portal Manager',
      email: 'portal-manager@profiles.test',
      client_id: segmentedClientId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    portalUserId = uuidv4();
    await table('users').insert({
      user_id: portalUserId,
      tenant: tenantId,
      username: 'portal-manager',
      email: 'portal-manager@profiles.test',
      hashed_password: 'test_hash',
      first_name: 'Portal',
      last_name: 'Manager',
      user_type: 'client',
      contact_id: portalContactId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // The portal billing-read permission is checked by joining role_permissions,
    // so the fixture needs a real role grant rather than a mocked check.
    const roleId = uuidv4();
    const permissionId = uuidv4();
    await table('roles').insert({
      role_id: roleId,
      tenant: tenantId,
      role_name: 'Portal Billing Reader',
      description: 'fixture',
      msp: false,
      client: true,
    });
    await table('permissions').insert({
      permission_id: permissionId,
      tenant: tenantId,
      resource: 'billing',
      action: 'read',
      msp: false,
      client: true,
    });
    await table('role_permissions').insert({
      tenant: tenantId,
      role_id: roleId,
      permission_id: permissionId,
    });
    await table('user_roles').insert({
      tenant: tenantId,
      user_id: portalUserId,
      role_id: roleId,
    });

    setupCommonMocks({
      tenantId,
      userId: portalUserId,
      user: {
        user_id: portalUserId,
        tenant: tenantId,
        user_type: 'client',
        contact_id: portalContactId,
        roles: [],
      } as any,
      permissionCheck: () => true,
    });

    await seedFinalizedInvoice(segmentedClientId, '2025-04-05', [
      { billingProfileId: northProfileId, net: 60000, tax: 4800, description: 'North April' },
      { billingProfileId: southProfileId, net: 40000, tax: 3200, description: 'South April' },
      { billingProfileId: corporateProfileId, net: 10000, tax: 800, description: 'Shared admin' },
    ]);

    ({ getPortalBillingProfiles, getPortalSpendByBillingProfile, getPortalChargesForBillingProfile } =
      await import('@alga-psa/client-portal/actions/client-portal-actions/client-billing-segments'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('T029: organization-wide spend equals the sum of per-segment spend', async () => {
    const spend: any = await getPortalSpendByBillingProfile({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(spend.rows).toHaveLength(3);
    const sumOfParts = spend.rows.reduce((sum: number, row: any) => sum + row.total, 0);
    expect(spend.organizationTotal).toBe(sumOfParts);
    expect(spend.organizationTotal).toBe(60000 + 4800 + 40000 + 3200 + 10000 + 800);
  }, HOOK_TIMEOUT);

  it('T029: per-segment drill-down returns only that segment’s charges', async () => {
    const charges: any = await getPortalChargesForBillingProfile({
      billingProfileId: northProfileId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(charges).toHaveLength(1);
    expect(charges[0].description).toBe('North April');
  }, HOOK_TIMEOUT);

  it('T030: a single-profile client is not segmented', async () => {
    // Point the portal user at the unsegmented client; the portal must offer no
    // segment UI, which it decides from this list having one entry.
    await table('contacts')
      .where({ contact_name_id: portalContactId })
      .update({ client_id: singleProfileClientId });
    try {
      const profiles: any = await getPortalBillingProfiles();
      expect(profiles).toHaveLength(1);
    } finally {
      await table('contacts')
        .where({ contact_name_id: portalContactId })
        .update({ client_id: segmentedClientId });
    }
  }, HOOK_TIMEOUT);

  it('T043: a restricted user sees only their segments, and their total reflects only those', async () => {
    await table('client_portal_user_billing_profiles').insert({
      tenant: tenantId,
      user_id: portalUserId,
      billing_profile_id: northProfileId,
    });
    try {
      const profiles: any = await getPortalBillingProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].billingProfileId).toBe(northProfileId);

      const spend: any = await getPortalSpendByBillingProfile({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
      // F125 — "whole organisation" is the whole of what they may see, not a
      // number they cannot reconcile against the breakdown below it.
      expect(spend.rows).toHaveLength(1);
      expect(spend.organizationTotal).toBe(64800);

      // F127 — asking for another segment directly is refused server-side.
      const forbidden: any = await getPortalChargesForBillingProfile({
        billingProfileId: southProfileId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
      expect(forbidden).toMatchObject({ permissionError: expect.any(String) });
    } finally {
      await table('client_portal_user_billing_profiles').where({ user_id: portalUserId }).del();
    }
  }, HOOK_TIMEOUT);

  it('T031: a portal user of another client sees nothing of this one', async () => {
    // Tenant scoping and client scoping both come from the contact, so a user
    // with no contact resolves to no client at all rather than to everything.
    await table('users').where({ user_id: portalUserId }).update({ contact_id: null });
    setupCommonMocks({
      tenantId,
      userId: portalUserId,
      user: {
        user_id: portalUserId,
        tenant: tenantId,
        user_type: 'client',
        contact_id: null,
        roles: [],
      } as any,
      permissionCheck: () => true,
    });
    try {
      const profiles: any = await getPortalBillingProfiles();
      expect(profiles).toMatchObject({ permissionError: expect.any(String) });
    } finally {
      await table('users').where({ user_id: portalUserId }).update({ contact_id: portalContactId });
      setupCommonMocks({
        tenantId,
        userId: portalUserId,
        user: {
          user_id: portalUserId,
          tenant: tenantId,
          user_type: 'client',
          contact_id: portalContactId,
          roles: [],
        } as any,
        permissionCheck: () => true,
      });
    }
  }, HOOK_TIMEOUT);
});
