import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

/**
 * Entry-point coverage for the catalog create contract (card
 * alga-2026-0002527): drive the real ServiceCatalogService and
 * ProductCatalogService against the migrated database instead of only the
 * shared resolver. Verifies omitted-inherits, explicit NULL, explicit override,
 * invalid override, and that an invalid configured default aborts before a
 * catalog row is written.
 */

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
}));

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ServiceCatalogService } from '../../../lib/api/services/ServiceCatalogService';
import { ProductCatalogService } from '../../../lib/api/services/ProductCatalogService';
import { InvalidDefaultTaxRateError, InvalidTaxRateSelectionError } from '@alga-psa/shared/billingClients/defaultTaxRate';

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantId: string;
let regionCode: string;
let configuredRateId: string;
let overrideRateId: string;
let serviceTypeId: string;
let serviceCatalog: ServiceCatalogService;
let productCatalog: ProductCatalogService;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

const context: any = {
  tenant: '',
  userId: uuidv4(),
  user: {},
};

async function createRate(percentage: number, region: string): Promise<string> {
  const taxRateId = uuidv4();
  await table('tax_rates').insert({
    tax_rate_id: taxRateId,
    tenant: tenantId,
    region_code: region,
    tax_percentage: percentage,
    description: `${region} ${percentage}%`,
    start_date: '2025-01-01',
    end_date: null,
    is_active: true,
  });
  return taxRateId;
}

async function setConfiguredDefault(taxRateId: string | null): Promise<void> {
  await table('tenant_settings')
    .insert({ tenant: tenantId, default_tax_rate_id: taxRateId })
    .onConflict('tenant')
    .merge({ default_tax_rate_id: taxRateId });
}

async function serviceRow(serviceId: string) {
  return table('service_catalog').where({ service_id: serviceId }).first();
}

describe('catalog create entrypoints honour the tenant default contract', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_default_tax_entrypoints' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'default tax entrypoint fixture')
      .insert({
        tenant: tenantId,
        client_name: 'Catalog Entrypoint Tenant',
        email: `catalog-entrypoint-${tenantId.slice(0, 8)}@tax.test`,
      });

    regionCode = 'AU-ENTRY';
    await table('tax_regions').insert({
      tenant: tenantId,
      region_code: regionCode,
      region_name: 'Entry Region',
      is_active: true,
    });
    configuredRateId = await createRate(10, regionCode);
    overrideRateId = await createRate(15, regionCode);

    serviceTypeId = uuidv4();
    await table('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: 'Entry Service Type',
      is_active: true,
    });

    serviceCatalog = new ServiceCatalogService();
    vi.spyOn(serviceCatalog as unknown as { getKnex: () => Promise<{ knex: Knex; tenant: string }> }, 'getKnex')
      .mockResolvedValue({ knex: db, tenant: tenantId });
    productCatalog = new ProductCatalogService();
    vi.spyOn(productCatalog as unknown as { getKnex: () => Promise<{ knex: Knex; tenant: string }> }, 'getKnex')
      .mockResolvedValue({ knex: db, tenant: tenantId });
    (context as { tenant: string }).tenant = tenantId;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await setConfiguredDefault(null);
  }, HOOK_TIMEOUT);

  it('ServiceCatalogService.create inherits the configured default when tax_rate_id is omitted', async () => {
    await setConfiguredDefault(configuredRateId);
    const created = await serviceCatalog.create(
      {
        service_name: 'Inherited Service',
        custom_service_type_id: serviceTypeId,
        billing_method: 'fixed',
        is_active: true,
        is_license: false,
      } as never,
      context,
    );
    expect((await serviceRow(created.service_id))?.tax_rate_id).toBe(configuredRateId);
  }, HOOK_TIMEOUT);

  it('ServiceCatalogService.create treats explicit null as non-taxable', async () => {
    await setConfiguredDefault(configuredRateId);
    const created = await serviceCatalog.create(
      {
        service_name: 'Non Taxable Service',
        custom_service_type_id: serviceTypeId,
        billing_method: 'fixed',
        is_active: true,
        is_license: false,
        tax_rate_id: null,
      } as never,
      context,
    );
    expect((await serviceRow(created.service_id))?.tax_rate_id).toBeNull();
  }, HOOK_TIMEOUT);

  it('ServiceCatalogService.create honours an explicit tenant rate override', async () => {
    await setConfiguredDefault(configuredRateId);
    const created = await serviceCatalog.create(
      {
        service_name: 'Override Service',
        custom_service_type_id: serviceTypeId,
        billing_method: 'fixed',
        is_active: true,
        is_license: false,
        tax_rate_id: overrideRateId,
      } as never,
      context,
    );
    expect((await serviceRow(created.service_id))?.tax_rate_id).toBe(overrideRateId);
  }, HOOK_TIMEOUT);

  it('ServiceCatalogService.create rejects an unknown override id', async () => {
    await expect(
      serviceCatalog.create(
        {
          service_name: 'Bad Override Service',
          custom_service_type_id: serviceTypeId,
          billing_method: 'fixed',
          is_active: true,
          is_license: false,
          tax_rate_id: uuidv4(),
        } as never,
        context,
      ),
    ).rejects.toBeInstanceOf(InvalidTaxRateSelectionError);
  }, HOOK_TIMEOUT);

  it('ProductCatalogService.create inherits the configured default and preserves explicit null', async () => {
    await setConfiguredDefault(configuredRateId);

    const inherited = await productCatalog.create(
      {
        service_name: 'Inherited Product',
        custom_service_type_id: serviceTypeId,
        is_active: true,
        is_license: false,
      } as never,
      context,
    );
    expect((await serviceRow(inherited.service_id))?.tax_rate_id).toBe(configuredRateId);

    const nonTaxable = await productCatalog.create(
      {
        service_name: 'Non Taxable Product',
        custom_service_type_id: serviceTypeId,
        is_active: true,
        is_license: false,
        tax_rate_id: null,
      } as never,
      context,
    );
    expect((await serviceRow(nonTaxable.service_id))?.tax_rate_id).toBeNull();
  }, HOOK_TIMEOUT);

  it('aborts before writing a catalog row when the configured default is invalid', async () => {
    const expired = await createRate(8, regionCode);
    await table('tax_rates')
      .where({ tenant: tenantId, tax_rate_id: expired })
      .update({ end_date: '2025-02-01' });
    await setConfiguredDefault(expired);

    const before = await table('service_catalog')
      .where({ service_name: 'Aborted Service' })
      .select('service_id');

    await expect(
      serviceCatalog.create(
        {
          service_name: 'Aborted Service',
          custom_service_type_id: serviceTypeId,
          billing_method: 'fixed',
          is_active: true,
          is_license: false,
        } as never,
        context,
      ),
    ).rejects.toBeInstanceOf(InvalidDefaultTaxRateError);

    const after = await table('service_catalog')
      .where({ service_name: 'Aborted Service' })
      .select('service_id');
    expect(after).toHaveLength(before.length);
  }, HOOK_TIMEOUT);
});
