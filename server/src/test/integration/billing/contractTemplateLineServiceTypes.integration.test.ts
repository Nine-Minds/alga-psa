/**
 * Managing services on NON-fixed contract template lines.
 *
 * Adding a service to an Hourly / Usage / Bucket template line used to fail
 * with "Service management for template lines currently supports fixed fee
 * lines only"; the template path now resolves the configuration type and the
 * per-type defaults the same way a live contract line does, and writes the
 * matching `contract_template_line_service_*_config` row.
 *
 * Real DB (see the integration-testing skill); the auth/tenant mocks mirror
 * createContractFromTemplate.integration.test.ts.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let addServiceToContractLine: typeof import('@alga-psa/billing/actions/contractLineServiceActions').addServiceToContractLine;
let updateContractLineService: typeof import('@alga-psa/billing/actions/contractLineServiceActions').updateContractLineService;
let applyContractLineServiceMembershipChanges: typeof import('@alga-psa/billing/actions/contractLineServiceActions').applyContractLineServiceMembershipChanges;
let addContractLine: typeof import('@alga-psa/billing/repositories/contractLineRepository').addContractLine;

const t = (table: string) => tenantDb(db, tenantId).table(table);

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

const authRef: { user: any; tenant: string } = { user: null, tenant: '' };

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(async () => authRef.user),
  getSession: vi.fn(async () =>
    authRef.user ? { user: { id: authRef.user.user_id, tenant: authRef.tenant } } : null
  ),
  hasPermission: vi.fn(async () => true),
  throwPermissionError: (action: string, additionalInfo?: string): never => {
    throw new Error(`Permission denied: Cannot ${action}${additionalInfo ? `. ${additionalInfo}` : ''}`);
  },
  withAuth: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, { tenant: authRef.tenant }, ...args);
  },
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(authRef.user ?? null, authRef.user ? { tenant: authRef.tenant } : null, ...args),
  withAuthCheck: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, ...args);
  },
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(authRef.tenant, () => action(authRef.user, { tenant: authRef.tenant }, ...args));
  },
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(authRef.user ?? null, authRef.user ? { tenant: authRef.tenant } : null, ...args),
  withAuthCheck: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, ...args);
  },
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    // A real transaction, so a rejected add rolls back like production.
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      (knexOrTrx as Knex).transaction((trx) => callback(trx)),
    ),
  };
});

const isActionError = (value: unknown): value is { actionError: string } =>
  typeof value === 'object' && value !== null && typeof (value as { actionError?: unknown }).actionError === 'string';

function ok<T>(result: T): T {
  expect(result, JSON.stringify(result)).toBeTruthy();
  expect(isActionError(result), JSON.stringify(result)).toBe(false);
  return result;
}

let serviceTypeId: string;

async function insertService(options: {
  name: string;
  billingMethod?: string;
  defaultRate?: number | null;
  unitOfMeasure?: string;
  itemKind?: 'service' | 'product';
}): Promise<string> {
  const serviceId = uuidv4();
  await t('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId,
    service_name: `${options.name} ${serviceId.slice(0, 6)}`,
    description: options.name,
    default_rate: options.defaultRate ?? null,
    unit_of_measure: options.unitOfMeasure ?? 'hour',
    billing_method: options.billingMethod ?? 'hourly',
    item_kind: options.itemKind ?? 'service',
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null,
  });
  // A template member rate is snapshotted from the catalog price IN THE
  // TEMPLATE'S BASE CURRENCY, never from the currency-untagged
  // service_catalog.default_rate, so the catalog needs a USD price row to match
  // the USD templates below.
  if (options.defaultRate != null) {
    await t('service_prices').insert({
      tenant: tenantId,
      service_id: serviceId,
      currency_code: 'USD',
      rate: options.defaultRate,
    });
  }
  return serviceId;
}

async function insertTemplateLine(lineType: 'Fixed' | 'Hourly' | 'Usage'): Promise<string> {
  const templateId = uuidv4();
  await t('contract_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `Template ${templateId.slice(0, 6)}`,
    default_billing_frequency: 'monthly',
    template_status: 'published',
    // Same base currency as the contracts these templates are cloned into, so
    // the clone reads the template's own amounts.
    currency_code: 'USD',
  });
  const templateLineId = uuidv4();
  await t('contract_template_lines').insert({
    tenant: tenantId,
    template_line_id: templateLineId,
    template_id: templateId,
    template_line_name: `${lineType} Line ${templateLineId.slice(0, 6)}`,
    billing_frequency: 'monthly',
    line_type: lineType,
  });
  return templateLineId;
}

async function templateConfig(templateLineId: string, serviceId: string) {
  return t('contract_template_line_service_configuration')
    .where({ template_line_id: templateLineId, service_id: serviceId })
    .first();
}

async function typeConfigRow(table: string, configId: string) {
  return t(table).where({ config_id: configId }).first();
}

describe('contract template lines: hourly, usage and bucket service management', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.E2E_AUTH_BYPASS = 'true';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    const { createUser } = await import('../../../../test-utils/testDataFactory');
    const userId = await createUser(db, tenantId, { username: 'template-service-types-user' });
    authRef.user = { user_id: userId, tenant: tenantId, user_type: 'internal', roles: [] };
    authRef.tenant = tenantId;
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });

    serviceTypeId = uuidv4();
    await t('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: `Template Service Types ${serviceTypeId.slice(0, 6)}`,
      order_number: Math.floor(Math.random() * 1_000_000),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    ({ addServiceToContractLine, updateContractLineService, applyContractLineServiceMembershipChanges } =
      await import('@alga-psa/billing/actions/contractLineServiceActions'));
    ({ addContractLine } = await import('@alga-psa/billing/repositories/contractLineRepository'));
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('adds a service to an Hourly template line with the catalog rate as the hourly rate', async () => {
    const templateLineId = await insertTemplateLine('Hourly');
    const serviceId = await insertService({ name: 'Service Desk', defaultRate: 12500 });

    const configId = ok(await addServiceToContractLine(templateLineId, serviceId, 1)) as string;

    const membership = await t('contract_template_line_services')
      .where({ template_line_id: templateLineId, service_id: serviceId })
      .first();
    expect(membership).toBeTruthy();
    expect(Number(membership.custom_rate)).toBe(12500);
    // Hourly work is not quantity-based; the wizard stores no quantity either.
    expect(membership.quantity).toBeNull();

    const config = await templateConfig(templateLineId, serviceId);
    expect(config.config_id).toBe(configId);
    expect(config.configuration_type).toBe('Hourly');
    expect(Number(config.custom_rate)).toBe(12500);
    expect(config.quantity).toBeNull();

    const hourly = await typeConfigRow('contract_template_line_service_hourly_config', configId);
    expect(Number(hourly.hourly_rate)).toBe(12500);
    expect([hourly.minimum_billable_time, hourly.round_up_to_nearest]).toEqual([15, 15]);
    // Only the hourly table carries a row for an hourly configuration.
    expect(await typeConfigRow('contract_template_line_service_fixed_config', configId)).toBeUndefined();
    expect(await typeConfigRow('contract_template_line_service_usage_config', configId)).toBeUndefined();
  }, 60_000);

  it('adds a service to a Usage template line with a unit code and the catalog rate', async () => {
    const templateLineId = await insertTemplateLine('Usage');
    const serviceId = await insertService({
      name: 'Backup Storage',
      billingMethod: 'usage',
      unitOfMeasure: 'GB',
      defaultRate: 350,
    });

    const configId = ok(await addServiceToContractLine(templateLineId, serviceId, 1)) as string;

    const config = await templateConfig(templateLineId, serviceId);
    expect(config.configuration_type).toBe('Usage');
    // Usage bills on reported consumption, so the member carries no quantity.
    expect(config.quantity).toBeNull();

    const usage = await typeConfigRow('contract_template_line_service_usage_config', configId);
    expect(Number(usage.base_rate)).toBe(350);
    expect(usage.unit_code).toBe('C62');
    expect(usage.unit_of_measure).toBeTruthy();
    expect(usage.enable_tiered_pricing).toBe(false);
  }, 60_000);

  it('adds a Bucket configuration on an Hourly template line with the overage rate defaulted', async () => {
    const templateLineId = await insertTemplateLine('Hourly');
    const serviceId = await insertService({ name: 'Prepaid Support', defaultRate: 9500 });

    const configId = ok(
      await addServiceToContractLine(templateLineId, serviceId, 1, undefined, 'Bucket'),
    ) as string;

    const config = await templateConfig(templateLineId, serviceId);
    expect(config.configuration_type).toBe('Bucket');

    const bucket = await typeConfigRow('contract_template_line_service_bucket_config', configId);
    expect(Number(bucket.overage_rate)).toBe(9500);
    expect(bucket.billing_period).toBe('monthly');
    expect(bucket.total_minutes).toBe(0);
    expect(bucket.allow_rollover).toBe(false);
  }, 60_000);

  it('re-adding a service under another configuration type swaps the per-type row', async () => {
    const templateLineId = await insertTemplateLine('Hourly');
    const serviceId = await insertService({ name: 'Swap Service', defaultRate: 7700 });

    const firstConfigId = ok(await addServiceToContractLine(templateLineId, serviceId, 1)) as string;
    expect(await typeConfigRow('contract_template_line_service_hourly_config', firstConfigId)).toBeTruthy();

    const secondConfigId = ok(
      await addServiceToContractLine(templateLineId, serviceId, 1, undefined, 'Bucket'),
    ) as string;
    expect(secondConfigId).toBe(firstConfigId);

    const config = await templateConfig(templateLineId, serviceId);
    expect(config.configuration_type).toBe('Bucket');
    expect(await typeConfigRow('contract_template_line_service_hourly_config', firstConfigId)).toBeUndefined();
    expect(await typeConfigRow('contract_template_line_service_bucket_config', firstConfigId)).toBeTruthy();
  }, 60_000);

  it('keeps the bucket overlay across Hourly/Usage/Bucket and drops it on Fixed', async () => {
    const templateLineId = await insertTemplateLine('Hourly');
    const serviceId = await insertService({ name: 'Overlaid Support', defaultRate: 8800 });

    const configId = ok(
      await addServiceToContractLine(templateLineId, serviceId, 1, undefined, 'Bucket', {
        total_minutes: 600,
      }),
    ) as string;
    expect(await typeConfigRow('contract_template_line_service_bucket_config', configId)).toBeTruthy();

    // Bucket -> Hourly: the prepaid pool terms are an overlay on the hourly
    // configuration, so re-typing the service must not discard them.
    ok(await addServiceToContractLine(templateLineId, serviceId, 1, undefined, 'Hourly'));
    const afterHourly = await templateConfig(templateLineId, serviceId);
    expect(afterHourly.configuration_type).toBe('Hourly');
    const overlay = await typeConfigRow('contract_template_line_service_bucket_config', configId);
    expect(overlay.total_minutes).toBe(600);

    // Hourly -> Fixed: a fixed fee configuration has no overlay to carry.
    const { ContractLineServiceConfigurationService } = await import(
      '@alga-psa/billing/services/contractLineServiceConfigurationService'
    );
    await new ContractLineServiceConfigurationService(db, tenantId).updateTemplateConfiguration(configId, {
      configuration_type: 'Fixed',
    } as any);

    expect(await typeConfigRow('contract_template_line_service_bucket_config', configId)).toBeUndefined();
    expect(await typeConfigRow('contract_template_line_service_hourly_config', configId)).toBeUndefined();
  }, 60_000);

  it('keeps a Fixed template add writing only the base rows', async () => {
    const templateLineId = await insertTemplateLine('Fixed');
    const serviceId = await insertService({
      name: 'Managed Bundle',
      billingMethod: 'fixed',
      unitOfMeasure: 'each',
      defaultRate: 50000,
    });

    const configId = ok(await addServiceToContractLine(templateLineId, serviceId, 2)) as string;

    const config = await templateConfig(templateLineId, serviceId);
    expect(config.configuration_type).toBe('Fixed');
    // Fixed members are quantity-based, unlike hourly and usage ones.
    expect(Number(config.quantity)).toBe(2);
    // This path stores no per-type fixed row; the member rate carries the price.
    expect(await typeConfigRow('contract_template_line_service_fixed_config', configId)).toBeUndefined();
    expect(await typeConfigRow('contract_template_line_service_hourly_config', configId)).toBeUndefined();
    expect(await typeConfigRow('contract_template_line_service_usage_config', configId)).toBeUndefined();
  }, 60_000);

  it('bills a service by the template line type, not its catalog billing method', async () => {
    // The line is the billing mode; catalog billing_method only supplies the
    // default rate (ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling).
    const hourlyLineId = await insertTemplateLine('Hourly');
    const fixedServiceId = await insertService({
      name: 'Fixed Bundle',
      billingMethod: 'fixed',
      unitOfMeasure: 'each',
      defaultRate: 40000,
    });

    const onHourlyConfigId = ok(await addServiceToContractLine(hourlyLineId, fixedServiceId, 1)) as string;
    const onHourlyConfig = await templateConfig(hourlyLineId, fixedServiceId);
    expect(onHourlyConfig.configuration_type).toBe('Hourly');
    const onHourlyRow = await typeConfigRow('contract_template_line_service_hourly_config', onHourlyConfigId);
    expect(Number(onHourlyRow.hourly_rate)).toBe(40000);

    const fixedLineId = await insertTemplateLine('Fixed');
    const hourlyServiceId = await insertService({ name: 'Hourly Desk', defaultRate: 15000 });

    ok(await addServiceToContractLine(fixedLineId, hourlyServiceId, 1));
    expect((await templateConfig(fixedLineId, hourlyServiceId)).configuration_type).toBe('Fixed');

    // A product is allowed on a fixed fee line even though it bills as usage.
    const productId = await insertService({
      name: 'Docking Station',
      billingMethod: 'usage',
      unitOfMeasure: 'each',
      defaultRate: 25000,
      itemKind: 'product',
    });
    const productConfigId = ok(await addServiceToContractLine(fixedLineId, productId, 1)) as string;
    const productConfig = await templateConfig(fixedLineId, productId);
    expect(productConfig.config_id).toBe(productConfigId);
    expect(productConfig.configuration_type).toBe('Fixed');
  }, 60_000);

  it('updates the per-type row for a service on an Hourly template line', async () => {
    const templateLineId = await insertTemplateLine('Hourly');
    const serviceId = await insertService({ name: 'Editable Desk', defaultRate: 10000 });
    const configId = ok(await addServiceToContractLine(templateLineId, serviceId, 1)) as string;

    ok(
      await updateContractLineService(templateLineId, serviceId, {
        customRate: 18000,
        typeConfig: { hourly_rate: 18000, minimum_billable_time: 30 },
      }),
    );

    const config = await templateConfig(templateLineId, serviceId);
    expect(Number(config.custom_rate)).toBe(18000);
    const membership = await t('contract_template_line_services')
      .where({ template_line_id: templateLineId, service_id: serviceId })
      .first();
    expect(Number(membership.custom_rate)).toBe(18000);

    const hourly = await typeConfigRow('contract_template_line_service_hourly_config', configId);
    expect(Number(hourly.hourly_rate)).toBe(18000);
    expect(hourly.minimum_billable_time).toBe(30);
    // Untouched columns keep their defaults.
    expect(hourly.round_up_to_nearest).toBe(15);
  }, 60_000);

  it('rejects rate tiers on a template line instead of dropping them', async () => {
    const templateLineId = await insertTemplateLine('Usage');
    const serviceId = await insertService({
      name: 'Tiered Usage',
      billingMethod: 'usage',
      unitOfMeasure: 'GB',
      defaultRate: 500,
    });
    ok(await addServiceToContractLine(templateLineId, serviceId, 1));

    const updateResult = await updateContractLineService(
      templateLineId,
      serviceId,
      { typeConfig: { enable_tiered_pricing: true } },
      [{ min_quantity: 1, max_quantity: 10, rate: 400 } as any],
    );
    expect(isActionError(updateResult)).toBe(true);
    expect((updateResult as { actionError: string }).actionError).toMatch(/not supported on contract template lines/);

    const addService = await insertService({
      name: 'Tiered Usage Two',
      billingMethod: 'usage',
      unitOfMeasure: 'GB',
      defaultRate: 500,
    });
    const addResult = await applyContractLineServiceMembershipChanges(templateLineId, {
      additions: [
        {
          serviceId: addService,
          configurationType: 'Usage',
          rateTiers: [{ min_quantity: 1, max_quantity: 10, rate: 400 } as any],
        },
      ],
      removals: [],
    });
    expect(isActionError(addResult)).toBe(true);
    expect(
      await t('contract_template_line_service_configuration')
        .where({ template_line_id: templateLineId, service_id: addService }),
    ).toHaveLength(0);
  }, 60_000);

  it('rejects a product on an Hourly template line and an hourly service with no rate', async () => {
    const templateLineId = await insertTemplateLine('Hourly');

    const productId = await insertService({
      name: 'Laptop',
      billingMethod: 'fixed',
      unitOfMeasure: 'each',
      defaultRate: 150000,
      itemKind: 'product',
    });
    const productResult = await addServiceToContractLine(templateLineId, productId, 1);
    expect(isActionError(productResult)).toBe(true);
    expect((productResult as { actionError: string }).actionError).toBe(
      'Products can only be added to fixed-fee contract lines.',
    );

    const unpricedId = await insertService({ name: 'Unpriced Desk', defaultRate: null });
    const unpricedResult = await addServiceToContractLine(templateLineId, unpricedId, 1);
    expect(isActionError(unpricedResult)).toBe(true);
    expect((unpricedResult as { actionError: string }).actionError).toMatch(/requires an hourly rate/);

    expect(
      await t('contract_template_line_services').where({ template_line_id: templateLineId }),
    ).toHaveLength(0);
  }, 60_000);

  it('carries the hourly and usage template config into a contract created from the template', async () => {
    const hourlyLineId = await insertTemplateLine('Hourly');
    const hourlyServiceId = await insertService({ name: 'Cloned Desk', defaultRate: 13500 });
    ok(await addServiceToContractLine(hourlyLineId, hourlyServiceId, 1));

    const usageLineId = await insertTemplateLine('Usage');
    const usageServiceId = await insertService({
      name: 'Cloned Storage',
      billingMethod: 'usage',
      unitOfMeasure: 'GB',
      defaultRate: 450,
    });
    ok(await addServiceToContractLine(usageLineId, usageServiceId, 1));

    const contractId = uuidv4();
    await t('contracts').insert({
      tenant: tenantId,
      contract_id: contractId,
      contract_name: `Template Instantiation ${contractId.slice(0, 6)}`,
      billing_frequency: 'monthly',
      is_template: false,
      status: 'draft',
      currency_code: 'USD',
    });

    await db.transaction(async (trx) => {
      await addContractLine(trx, tenantId, contractId, hourlyLineId);
      await addContractLine(trx, tenantId, contractId, usageLineId);
    });

    const liveConfigs = await t('contract_line_service_configuration as c')
      .join('contract_lines as l', function joinLines() {
        this.on('l.contract_line_id', 'c.contract_line_id').andOn('l.tenant', 'c.tenant');
      })
      .where({ 'l.contract_id': contractId })
      .select('c.config_id', 'c.service_id', 'c.configuration_type');
    const byService = new Map<string, any>(liveConfigs.map((row: any) => [row.service_id, row]));

    const hourlyConfig = byService.get(hourlyServiceId);
    expect(hourlyConfig.configuration_type).toBe('Hourly');
    const liveHourlyRate = await t('contract_line_service_hourly_configs')
      .where({ config_id: hourlyConfig.config_id })
      .first();
    expect(Number(liveHourlyRate.hourly_rate)).toBe(13500);
    expect([liveHourlyRate.minimum_billable_time, liveHourlyRate.round_up_to_nearest]).toEqual([15, 15]);
    expect(
      await t('contract_line_service_hourly_config').where({ config_id: hourlyConfig.config_id }).first(),
    ).toBeTruthy();

    const usageConfig = byService.get(usageServiceId);
    expect(usageConfig.configuration_type).toBe('Usage');
    const liveUsage = await t('contract_line_service_usage_config')
      .where({ config_id: usageConfig.config_id })
      .first();
    expect(Number(liveUsage.base_rate)).toBe(450);
    expect(liveUsage.unit_code).toBe('C62');
  }, 120_000);
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture reads tenant rows')
    .first<{ tenant: string }>('tenant');
  if (existing?.tenant) return existing.tenant;
  const newTenantId = uuidv4();
  await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates tenant rows')
    .insert({
      tenant: newTenantId,
      client_name: 'Template Service Types Integration Test Tenant',
      email: 'template-service-types@test.co',
      created_at: connection.fn.now(),
      updated_at: connection.fn.now(),
    });
  return newTenantId;
}
