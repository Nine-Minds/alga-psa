import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';
import { createDefaultTaxSettings } from '@alga-psa/shared/billingClients';

/**
 * Mitigation round — the shared `createDefaultTaxSettings` must key its
 * `client_tax_settings` insert to the client's default billing profile.
 *
 * S7 re-keyed the table to (tenant, client_id, billing_profile_id) with a NOT
 * NULL profile column. The service-layer `TaxService` writers were fixed, but
 * this shared writer — reached from UI client creation
 * (`createDefaultTaxSettingsAsync`), client lookup actions, and Entra
 * provisioning — still inserted without a profile. The insert violated NOT
 * NULL, UI client creation failed with "Missing required client field:
 * billing_profile_id", and retry then tripped over the non-transactional
 * client+profile rows that had already committed. Before the fix this suite
 * fails with a 23502 NOT NULL violation.
 */

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantId: string;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

describe('mitigation — shared createDefaultTaxSettings keys the default billing profile', () => {
  let clientId: string;
  let bareClientId: string;
  let defaultProfileId: string;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'Shared Writer Fixture',
        email: `shared-writer-${tenantId.slice(0, 8)}@tax.test`,
      });

    clientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Profiled Client',
      billing_cycle: 'monthly',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // The UI create-client shape: the client's default profile already exists
    // when the shared writer runs.
    defaultProfileId = await ensureDefaultBillingProfile(
      { db, tenantId },
      clientId,
      { name: 'Profiled Client' },
    );
    await createBillingProfile({ db, tenantId }, clientId, 'Second Entity');

    // The client-lookup/Entra shape: no profile exists yet, the writer must
    // provision the default itself rather than insert an unkeyed row.
    bareClientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId,
      client_id: bareClientId,
      client_name: 'Bare Client',
      billing_cycle: 'monthly',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await table('tax_regions')
      .insert({
        tenant: tenantId,
        region_code: 'US-MT',
        region_name: 'Shared Writer Region',
        is_active: true,
      })
      .onConflict(['tenant', 'region_code'])
      .ignore();
    await table('tax_rates').insert({
      tax_rate_id: uuidv4(),
      tenant: tenantId,
      region_code: 'US-MT',
      tax_percentage: 6.25,
      description: 'US-MT Tax',
      start_date: '2025-01-01T00:00:00.000Z',
      is_active: true,
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  async function resetTaxRows(): Promise<void> {
    await table('client_tax_settings').where({ client_id: clientId }).del();
    await table('client_tax_rates').where({ client_id: clientId }).del();
  }

  it('seeds the smoke condition: the client exists with profiles but no tax settings', async () => {
    // The suite shuffles test order, so state the precondition from a clean
    // slate rather than assuming this runs before the writers below.
    await resetTaxRows();
    expect(defaultProfileId).toBeTruthy();
    expect(await table('client_billing_profiles').where({ client_id: clientId })).toHaveLength(2);
    expect(await table('client_tax_settings').where({ client_id: clientId })).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('writes client_tax_settings keyed to the default profile instead of throwing 23502', async () => {
    await resetTaxRows();

    await expect(createDefaultTaxSettings(db, tenantId, clientId)).resolves.toMatchObject({
      client_id: clientId,
      billing_profile_id: defaultProfileId,
    });

    const settings = await table('client_tax_settings').where({ client_id: clientId });
    expect(settings).toHaveLength(1);
    expect(settings[0].billing_profile_id).toBe(defaultProfileId);
    expect(settings[0].is_reverse_charge_applicable).toBe(false);

    const defaultRate = await table('client_tax_rates')
      .where({ client_id: clientId, is_default: true })
      .whereNull('location_id')
      .first();
    expect(defaultRate).toBeTruthy();
  }, HOOK_TIMEOUT);

  it('provisions the default profile for a client that has none yet', async () => {
    await expect(createDefaultTaxSettings(db, tenantId, bareClientId)).resolves.toMatchObject({
      client_id: bareClientId,
    });

    const profiles = await table('client_billing_profiles').where({ client_id: bareClientId });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ is_default: true, is_active: true });

    const settings = await table('client_tax_settings').where({ client_id: bareClientId });
    expect(settings).toHaveLength(1);
    expect(settings[0].billing_profile_id).toBe(profiles[0].billing_profile_id);
  }, HOOK_TIMEOUT);
});
