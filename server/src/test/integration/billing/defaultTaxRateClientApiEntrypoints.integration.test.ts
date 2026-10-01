import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

/**
 * ClientService.create entrypoint coverage for the tenant default tax rate
 * (card alga-2026-0002527): PSA tenants inherit the configured default
 * atomically, an invalid configured default rolls the client back, and
 * AlgaDesk tenants (which have no tax rates by product design) are exempted
 * rather than failed.
 */

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ClientService } from '../../../lib/api/services/ClientService';
import { InvalidDefaultTaxRateError } from '@alga-psa/shared/billingClients/defaultTaxRate';
import type { IClient } from 'server/src/interfaces/client.interfaces';

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let psaTenant: string;
let algadeskTenant: string;
let invalidPsaTenant: string;
let configuredRateId: string;
let service: ClientService;

function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}

async function createTenant(tenant: string, productCode: 'psa' | 'algadesk', label: string) {
  await tenantDb(db, tenant)
    .unscoped('tenants', 'default tax client api fixture')
    .insert({
      tenant,
      client_name: label,
      email: `${label}-${tenant.slice(0, 8)}@tax.test`,
      product_code: productCode,
    });
}

async function seedRegionAndRate(tenant: string, endDate: string | null = null): Promise<string> {
  await table(tenant, 'tax_regions')
    .insert({ tenant, region_code: 'AU-CLIENTAPI', region_name: 'Client API', is_active: true })
    .onConflict(['tenant', 'region_code'])
    .ignore();

  const taxRateId = uuidv4();
  await table(tenant, 'tax_rates').insert({
    tax_rate_id: taxRateId,
    tenant,
    region_code: 'AU-CLIENTAPI',
    tax_percentage: 10,
    description: 'Client API GST',
    start_date: '2025-01-01',
    end_date: endDate,
    is_active: true,
  });
  return taxRateId;
}

async function setConfiguredDefault(tenant: string, taxRateId: string): Promise<void> {
  await table(tenant, 'tenant_settings')
    .insert({ tenant, default_tax_rate_id: taxRateId })
    .onConflict('tenant')
    .merge({ default_tax_rate_id: taxRateId });
}

async function createClientForTenant(tenant: string, clientName: string): Promise<IClient> {
  (service as unknown as { getKnex: () => Promise<{ knex: Knex; tenant: string }> }).getKnex = async () => ({
    knex: db,
    tenant,
  });
  return service.create(
    { client_name: clientName, billing_cycle: 'monthly' } as never,
    { tenant, userId: uuidv4(), user: {} } as never,
  );
}

describe('ClientService.create default tax rate entrypoint', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_default_tax_client_api' });
    service = new ClientService();

    psaTenant = uuidv4();
    algadeskTenant = uuidv4();
    invalidPsaTenant = uuidv4();
    await createTenant(psaTenant, 'psa', 'PSA Client API Tenant');
    await createTenant(algadeskTenant, 'algadesk', 'AlgaDesk Client API Tenant');
    await createTenant(invalidPsaTenant, 'psa', 'Invalid PSA Client API Tenant');

    configuredRateId = await seedRegionAndRate(psaTenant);
    await setConfiguredDefault(psaTenant, configuredRateId);

    const expiredRateId = await seedRegionAndRate(invalidPsaTenant, '2025-02-01');
    await setConfiguredDefault(invalidPsaTenant, expiredRateId);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('creates an AlgaDesk client without any tax rates and skips tax setup', async () => {
    const client = await createClientForTenant(algadeskTenant, 'AlgaDesk No Tax Client');

    const row = await table(algadeskTenant, 'clients')
      .where({ client_id: client.client_id })
      .first();
    expect(row).toBeTruthy();

    expect(await table(algadeskTenant, 'client_tax_settings').where({ client_id: client.client_id })).toHaveLength(0);
    expect(await table(algadeskTenant, 'client_tax_rates').where({ client_id: client.client_id })).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('assigns the configured tenant default to a new PSA client', async () => {
    const client = await createClientForTenant(psaTenant, 'PSA Inherited Default Client');

    const defaults = await table(psaTenant, 'client_tax_rates')
      .where({ client_id: client.client_id, is_default: true })
      .whereNull('location_id');
    expect(defaults).toHaveLength(1);
    expect(defaults[0].tax_rate_id).toBe(configuredRateId);
  }, HOOK_TIMEOUT);

  it('rolls the PSA client back when the configured default is invalid', async () => {
    await expect(createClientForTenant(invalidPsaTenant, 'PSA Invalid Default Client')).rejects.toBeInstanceOf(
      InvalidDefaultTaxRateError,
    );

    const rows = await table(invalidPsaTenant, 'clients')
      .where({ client_name: 'PSA Invalid Default Client' })
      .select('client_id');
    expect(rows).toHaveLength(0);
  }, HOOK_TIMEOUT);
});
