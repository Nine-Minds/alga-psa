import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';
import { getClientDefaultTaxRegionCode } from '@alga-psa/shared/billingClients';
import { TaxService } from '@alga-psa/billing/services';

/**
 * Mitigation round — `ensureDefaultTaxSettings` must key its
 * `client_tax_settings` insert to the client's default billing profile.
 *
 * S7 re-keyed the table to (tenant, client_id, billing_profile_id) with a NOT
 * NULL profile column, and fixed the sibling `createDefaultTaxSettings`, but
 * this method still inserted without a profile. For any pre-existing client
 * with profiles but no tax settings row, the insert violated NOT NULL, the
 * auto-configuration in `createInvoiceFromBillingResult` failed, and invoice
 * generation aborted with "Client does not have a default tax region
 * configured" — the exact smoke failure this suite reproduces.
 */

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantId: string;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
  };
});

describe('mitigation — ensureDefaultTaxSettings provisions the default billing profile', () => {
  let clientId: string;
  let defaultProfileId: string;
  let secondProfileId: string;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'Mitigation Fixture',
        email: `mitigation-${tenantId.slice(0, 8)}@tax.test`,
      });

    clientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Untaxed Client',
      billing_cycle: 'monthly',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    defaultProfileId = await ensureDefaultBillingProfile(
      { db, tenantId },
      clientId,
      { name: 'Untaxed Client' },
    );
    secondProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Second Entity');

    await table('tax_regions')
      .insert({
        tenant: tenantId,
        region_code: 'US-MT',
        region_name: 'Mitigation Region',
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

  it('seeds the smoke condition: profiles exist, tax settings do not', async () => {
    await resetTaxRows();
    expect(defaultProfileId).toBeTruthy();
    expect(secondProfileId).toBeTruthy();
    expect(await table('client_billing_profiles').where({ client_id: clientId })).toHaveLength(2);
    expect(await table('client_tax_settings').where({ client_id: clientId })).toHaveLength(0);
    expect(await getClientDefaultTaxRegionCode(db, tenantId, clientId)).toBeNull();
  }, HOOK_TIMEOUT);

  it('inserts client_tax_settings keyed to the default profile and unblocks invoice generation', async () => {
    await resetTaxRows();

    await expect(new TaxService().ensureDefaultTaxSettings(clientId)).resolves.toBeUndefined();

    const settings = await table('client_tax_settings').where({ client_id: clientId });
    expect(settings).toHaveLength(1);
    expect(settings[0].billing_profile_id).toBe(defaultProfileId);

    const defaultRate = await table('client_tax_rates')
      .where({ client_id: clientId, is_default: true })
      .whereNull('location_id')
      .first();
    expect(defaultRate).toBeTruthy();

    expect(await getClientDefaultTaxRegionCode(db, tenantId, clientId)).toBe('US-MT');
  }, HOOK_TIMEOUT);

  it('is idempotent: repeat calls neither throw nor duplicate rows', async () => {
    await resetTaxRows();

    const taxService = new TaxService();
    await taxService.ensureDefaultTaxSettings(clientId);
    await taxService.ensureDefaultTaxSettings(clientId);

    const settings = await table('client_tax_settings').where({ client_id: clientId });
    expect(settings).toHaveLength(1);
    expect(settings[0].billing_profile_id).toBe(defaultProfileId);
  }, HOOK_TIMEOUT);
});
