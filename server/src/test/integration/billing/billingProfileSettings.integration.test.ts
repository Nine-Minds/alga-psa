import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';
import { resolveEffectiveBillingIdentity } from '@alga-psa/shared/billingClients/billingProfileSettings';

/**
 * S7 — profile bill-to identity and the re-keyed tax settings (T032, T046).
 *
 * The property under test is inheritance, field by field. A profile with
 * nothing filled in must behave exactly as the client does today — that is what
 * keeps the backward-compatibility gate holding while phase-2 columns exist on
 * the table. And setting one field must not blank the rest: an MSP that sets
 * only a PO number keeps inheriting the bill-to name and the delivery method.
 */

const require = createRequire(import.meta.url);
const HOOK_TIMEOUT = 300_000;
const MIGRATION_DIR = path.resolve(process.cwd(), 'migrations');
const s7Migration = require(
  path.join(MIGRATION_DIR, '20260818040000_add_billing_profile_bill_to_and_tax.cjs'),
);

let db: Knex;
let tenantId: string;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

describe('billing profiles S7 — bill-to identity and profile tax (T032, T046)', () => {
  let clientId: string;
  let defaultProfileId: string;
  let entityProfileId: string;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'S7 Fixture',
        email: `s7-${tenantId.slice(0, 8)}@profiles.test`,
      });

    clientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Shared Site Group',
      billing_cycle: 'monthly',
      billing_email: 'ap@sharedsite.test',
      payment_terms: 'net_30',
      invoice_delivery_method: 'email',
      is_tax_exempt: false,
      tax_id_number: 'CLIENT-TAX-1',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId, {
      name: 'Shared Site Group',
    });
    entityProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Entity B');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  // Each test uses its own profile: the suite runs shuffled, and these tests
  // mutate the profile they read.
  it('T032: a profile with nothing set inherits every field from the client', async () => {
    const pristineProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Untouched Entity');
    const effective = await resolveEffectiveBillingIdentity(db, tenantId, clientId, pristineProfileId);

    expect(effective).toMatchObject({
      billToName: 'Shared Site Group',
      billingEmail: 'ap@sharedsite.test',
      paymentTerms: 'net_30',
      invoiceDeliveryMethod: 'email',
      billingCycle: 'monthly',
      isTaxExempt: false,
      taxIdNumber: 'CLIENT-TAX-1',
      billsSeparately: false,
    });
    // Nothing was overridden, so nothing is reported as overridden.
    expect(effective.overriddenFields).toEqual([]);
  }, HOOK_TIMEOUT);

  it('T032: setting one field overrides only that field', async () => {
    const overriddenProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Entity B');
    await table('client_billing_profiles')
      .where({ billing_profile_id: overriddenProfileId })
      .update({ po_number: 'PO-9911', bill_to_name: 'Entity B Ltd' });

    const effective = await resolveEffectiveBillingIdentity(db, tenantId, clientId, overriddenProfileId);

    expect(effective.billToName).toBe('Entity B Ltd');
    expect(effective.poNumber).toBe('PO-9911');
    // Everything else still comes from the client — an all-or-nothing switch
    // would have blanked these.
    expect(effective.billingEmail).toBe('ap@sharedsite.test');
    expect(effective.paymentTerms).toBe('net_30');
    expect(effective.overriddenFields).toEqual(['bill_to_name']);
  }, HOOK_TIMEOUT);

  it('T045: profile tax exemption overrides the client, and null keeps inheriting', async () => {
    // The one-site-many-legal-entities shape: one exempt entity and one not, at
    // the same address, on the same client.
    const exemptProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Exempt Entity');
    await table('client_billing_profiles')
      .where({ billing_profile_id: exemptProfileId })
      .update({ is_tax_exempt: true, tax_id_number: 'ENTITY-B-TAX' });

    const entity = await resolveEffectiveBillingIdentity(db, tenantId, clientId, exemptProfileId);
    const fallback = await resolveEffectiveBillingIdentity(db, tenantId, clientId, defaultProfileId);

    expect(entity.isTaxExempt).toBe(true);
    expect(entity.taxIdNumber).toBe('ENTITY-B-TAX');
    expect(fallback.isTaxExempt).toBe(false);
    expect(fallback.taxIdNumber).toBe('CLIENT-TAX-1');
  }, HOOK_TIMEOUT);

  it('T046: client_tax_settings is keyed per profile and existing rows backfilled to the default', async () => {
    const columns = await db('client_tax_settings').columnInfo();
    expect(columns.billing_profile_id).toBeTruthy();

    // Two profiles of one client can hold different reverse-charge settings —
    // the thing the pre-S7 primary key made impossible.
    await table('client_tax_settings').where({ client_id: clientId }).del();
    await table('client_tax_settings').insert([
      {
        tenant: tenantId,
        client_id: clientId,
        billing_profile_id: defaultProfileId,
        is_reverse_charge_applicable: false,
      },
      {
        tenant: tenantId,
        client_id: clientId,
        billing_profile_id: entityProfileId,
        is_reverse_charge_applicable: true,
      },
    ]);

    const rows = await table('client_tax_settings').where({ client_id: clientId });
    expect(rows).toHaveLength(2);
    expect(
      rows.find((row: any) => row.billing_profile_id === entityProfileId)
        .is_reverse_charge_applicable,
    ).toBe(true);
  }, HOOK_TIMEOUT);

  it('T046: the S7 migration is idempotent and its down migration collapses to the default profile', async () => {
    // Seeded here rather than shared with the test above: the suite runs
    // shuffled, and this one rolls the schema back under everything else.
    await table('client_tax_settings').where({ client_id: clientId }).del();
    await table('client_tax_settings').insert([
      {
        tenant: tenantId,
        client_id: clientId,
        billing_profile_id: defaultProfileId,
        is_reverse_charge_applicable: false,
      },
      {
        tenant: tenantId,
        client_id: clientId,
        billing_profile_id: entityProfileId,
        is_reverse_charge_applicable: true,
      },
    ]);

    // Re-running up must not duplicate or fail — migrations get re-applied
    // across environments.
    await s7Migration.up(db);
    expect(await table('client_tax_settings').where({ client_id: clientId })).toHaveLength(2);

    await s7Migration.down(db);
    const afterDown = await table('client_tax_settings').where({ client_id: clientId });
    // The default profile's row is the one the pre-S7 schema would have held.
    expect(afterDown).toHaveLength(1);
    expect(await db.schema.hasColumn('client_billing_profiles', 'bills_separately')).toBe(false);

    await s7Migration.up(db);
    expect(await db.schema.hasColumn('client_billing_profiles', 'bills_separately')).toBe(true);
  }, HOOK_TIMEOUT);
});
