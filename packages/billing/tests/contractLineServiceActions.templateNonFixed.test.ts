import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
}));

function makeBuilder(table: string) {
  let filters: Row = {};
  const rows = () => (mocks.tables[table] ??= []);
  const matching = () => rows().filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
  const builder: any = {};
  builder.where = (criteria: Row) => {
    filters = { ...filters, ...criteria };
    return builder;
  };
  builder.orderByRaw = () => builder;
  builder.select = () => builder;
  builder.first = async () => matching()[0];
  builder.insert = async (row: Row) => {
    rows().push({ ...row });
  };
  builder.update = async (patch: Row) => {
    const hits = matching();
    hits.forEach((r) => Object.assign(r, patch));
    return hits.length;
  };
  builder.delete = async () => {
    const hits = matching();
    mocks.tables[table] = rows().filter((r) => !hits.includes(r));
    return hits.length;
  };
  return builder;
}

const trx: any = (table: string) => makeBuilder(table);
trx.fn = { now: () => 'now' };
trx.transaction = async (cb: (t: any) => unknown) => cb(trx);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: trx }),
  tenantDb: (connection: any) => ({ table: (table: string) => connection(table) }),
  withTransaction: async (_db: unknown, cb: (t: any) => unknown) => cb(trx),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: unknown[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('../src/actions/contractLineServiceConfigurationActions', () => ({}));

const TENANT = 'tenant-1';

function seed(lineType: string, service: Row = {}) {
  mocks.tables = {
    contract_template_lines: [
      { tenant: TENANT, template_line_id: 'tl-1', line_type: lineType, billing_frequency: 'monthly' },
    ],
    service_catalog: [
      { tenant: TENANT, service_id: 'svc-1', service_name: 'Svc', is_active: true, item_kind: 'service', default_rate: 12500, ...service },
    ],
  };
}

const rowsOf = (table: string) => mocks.tables[table] ?? [];

describe('template line service management for non-Fixed lines', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('adds a service to an Hourly template line with defaults', async () => {
    seed('Hourly');
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    const configId = await addServiceToContractLine('tl-1', 'svc-1');
    expect(typeof configId).toBe('string');
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({
      configuration_type: 'Hourly',
      template_line_id: 'tl-1',
      config_id: configId,
    });
    expect(rowsOf('contract_template_line_service_hourly_config')[0]).toMatchObject({
      tenant: TENANT,
      config_id: configId,
      hourly_rate: 12500,
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
    });
  });

  it('adds a service to a Usage template line', async () => {
    seed('Usage');
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    const configId = await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Usage', {
      unit_of_measure: 'GB',
    } as any);
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({
      configuration_type: 'Usage',
      quantity: null,
    });
    expect(rowsOf('contract_template_line_service_usage_config')[0]).toMatchObject({
      config_id: configId,
      unit_of_measure: 'GB',
      enable_tiered_pricing: false,
    });
    // The fixture prices the service only through the currency-untagged
    // service_catalog.default_rate, which a template no longer snapshots: an
    // amount is taken from the catalog in the template's own currency or left
    // unset to follow the catalog at billing time.
    expect(rowsOf('contract_template_line_service_usage_config')[0].base_rate).toBeUndefined();
  });

  it('adds a Bucket configuration to an Hourly template line with overage_rate defaulted', async () => {
    seed('Hourly');
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    const configId = await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Bucket', {
      total_minutes: 600,
    } as any);
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({
      configuration_type: 'Bucket',
    });
    expect(rowsOf('contract_template_line_service_bucket_config')[0]).toMatchObject({
      config_id: configId,
      total_minutes: 600,
      overage_rate: 12500,
      billing_period: 'monthly',
    });
  });

  it('keeps Fixed template lines writing only base rows', async () => {
    seed('Fixed');
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    await addServiceToContractLine('tl-1', 'svc-1', 2);
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({
      configuration_type: 'Fixed',
      quantity: 2,
    });
    expect(rowsOf('contract_template_line_service_hourly_config')).toHaveLength(0);
    expect(rowsOf('contract_template_line_service_usage_config')).toHaveLength(0);
  });

  it('stores no quantity on Hourly rows, matching the template wizard', async () => {
    seed('Hourly');
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    await addServiceToContractLine('tl-1', 'svc-1', 3);
    expect(rowsOf('contract_template_line_services')[0]).toMatchObject({ quantity: null });
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({ quantity: null });
  });

  it('bills a service by the line type, not its catalog billing method', async () => {
    // The template line is the billing mode: a fixed-method service added to an
    // Hourly line lands as Hourly, an hourly one on a Fixed line lands as Fixed
    // (ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling).
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');

    seed('Hourly', { billing_method: 'fixed', service_name: 'Managed Bundle' });
    expect(typeof (await addServiceToContractLine('tl-1', 'svc-1'))).toBe('string');
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({
      configuration_type: 'Hourly',
    });
    expect(rowsOf('contract_template_line_service_hourly_config')[0]).toMatchObject({ hourly_rate: 12500 });

    seed('Fixed', { billing_method: 'hourly', service_name: 'Basic Support' });
    expect(typeof (await addServiceToContractLine('tl-1', 'svc-1'))).toBe('string');
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({
      configuration_type: 'Fixed',
    });
  });

  it('allows a product on a Fixed template line despite its usage billing method', async () => {
    seed('Fixed', { billing_method: 'usage', item_kind: 'product', service_name: 'Laptop' });
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    const configId = await addServiceToContractLine('tl-1', 'svc-1', 2);
    expect(typeof configId).toBe('string');
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({
      configuration_type: 'Fixed',
      quantity: 2,
    });
  });

  it('keeps the bucket overlay through Bucket -> Hourly and drops it on Fixed', async () => {
    seed('Hourly');
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    const configId = await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Bucket', {
      total_minutes: 600,
    } as any);
    expect(rowsOf('contract_template_line_service_bucket_config')).toHaveLength(1);

    // Re-typing an overlaid service to Hourly keeps the prepaid pool terms.
    await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Hourly');
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({
      config_id: configId,
      configuration_type: 'Hourly',
    });
    expect(rowsOf('contract_template_line_service_bucket_config')[0]).toMatchObject({ total_minutes: 600 });

    // A Fixed configuration has no overlay to keep.
    const { ContractLineServiceConfigurationService } = await import(
      '../src/services/contractLineServiceConfigurationService'
    );
    const svc = new ContractLineServiceConfigurationService(trx, TENANT);
    await svc.updateTemplateConfiguration(configId as string, { configuration_type: 'Fixed' } as any);
    expect(rowsOf('contract_template_line_service_bucket_config')).toHaveLength(0);
    expect(rowsOf('contract_template_line_service_hourly_config')).toHaveLength(0);
  });

  it('rejects invalid config types, products and inactive services', async () => {
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    seed('Hourly');
    const badType = await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Usage');
    expect(badType).toMatchObject({ actionError: expect.stringContaining('Configuration type') });
    seed('Usage', { item_kind: 'product' });
    expect(await addServiceToContractLine('tl-1', 'svc-1')).toMatchObject({
      actionError: expect.stringContaining('Products can only be added'),
    });
    seed('Hourly', { is_active: false });
    expect(await addServiceToContractLine('tl-1', 'svc-1')).toMatchObject({
      actionError: expect.stringContaining('inactive'),
    });
  });

  it('updates a template Hourly service via updateContractLineService', async () => {
    seed('Hourly');
    const { addServiceToContractLine, updateContractLineService } = await import(
      '../src/actions/contractLineServiceActions'
    );
    const configId = await addServiceToContractLine('tl-1', 'svc-1');
    const result = await updateContractLineService('tl-1', 'svc-1', {
      quantity: 3,
      typeConfig: { hourly_rate: 20000, minimum_billable_time: 30 } as any,
    });
    expect(result).toBe(true);
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({ config_id: configId, quantity: 3 });
    expect(rowsOf('contract_template_line_services')[0]).toMatchObject({ quantity: 3 });
    expect(rowsOf('contract_template_line_service_hourly_config')[0]).toMatchObject({
      hourly_rate: 20000,
      minimum_billable_time: 30,
      round_up_to_nearest: 15,
    });
  });

  it('upserts template hourly/usage/bucket configuration through the configuration service', async () => {
    seed('Hourly');
    const { ContractLineServiceConfigurationService } = await import(
      '../src/services/contractLineServiceConfigurationService'
    );
    const svc = new ContractLineServiceConfigurationService(trx, TENANT);
    const configId = await svc.upsertPlanServiceHourlyConfiguration('tl-1', 'svc-1', { hourly_rate: 9000 });
    await svc.upsertPlanServiceHourlyConfiguration('tl-1', 'svc-1', { hourly_rate: 9500 });
    expect(rowsOf('contract_template_line_service_hourly_config')).toHaveLength(1);
    expect(rowsOf('contract_template_line_service_hourly_config')[0]).toMatchObject({ config_id: configId, hourly_rate: 9500 });

    const bucketId = await svc.upsertPlanServiceBucketConfiguration('tl-1', 'svc-1', {
      total_minutes: 120,
      overage_rate: 100,
    });
    // overlay attaches to the existing primary config and does not retype it
    expect(bucketId).toBe(configId);
    expect(rowsOf('contract_template_line_service_configuration')[0].configuration_type).toBe('Hourly');
    expect(rowsOf('contract_template_line_service_bucket_config')[0]).toMatchObject({ total_minutes: 120 });

    expect(await svc.getConfigurationForService('tl-1', 'svc-1')).toMatchObject({
      config_id: configId,
      contract_line_id: 'tl-1',
    });

    seed('Usage');
    const usageId = await svc.upsertPlanServiceUsageConfiguration('tl-1', 'svc-1', { unit_rate: 400, unit_of_measure: 'GB' });
    expect(rowsOf('contract_template_line_service_usage_config')[0]).toMatchObject({
      config_id: usageId,
      base_rate: 400,
      unit_of_measure: 'GB',
    });
  });

  it('adds a Bucket-typed service to a Fixed template line', async () => {
    seed('Fixed');
    const { addServiceToContractLine } = await import('../src/actions/contractLineServiceActions');
    const configId = await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Bucket', {
      total_minutes: 300,
    } as any);
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({ configuration_type: 'Bucket' });
    expect(rowsOf('contract_template_line_service_bucket_config')[0]).toMatchObject({
      config_id: configId,
      total_minutes: 300,
      overage_rate: 12500,
    });
  });

  it('updates template Usage and Bucket services via updateContractLineService', async () => {
    const { addServiceToContractLine, updateContractLineService } = await import(
      '../src/actions/contractLineServiceActions'
    );
    seed('Usage');
    await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Usage');
    expect(
      await updateContractLineService('tl-1', 'svc-1', { typeConfig: { unit_of_measure: 'GB', minimum_usage: 5 } as any }),
    ).toBe(true);
    expect(rowsOf('contract_template_line_service_usage_config')[0]).toMatchObject({ unit_of_measure: 'GB', minimum_usage: 5 });

    seed('Fixed');
    await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Bucket', { total_minutes: 60 } as any);
    expect(
      await updateContractLineService('tl-1', 'svc-1', { typeConfig: { total_minutes: 90, allow_rollover: true } as any }),
    ).toBe(true);
    expect(rowsOf('contract_template_line_service_bucket_config')[0]).toMatchObject({ total_minutes: 90, allow_rollover: true });
  });

  it('rejects rate tiers on template lines instead of dropping them', async () => {
    seed('Usage');
    const { addServiceToContractLine, updateContractLineService } = await import(
      '../src/actions/contractLineServiceActions'
    );
    const tiers = [{ min_quantity: 1, rate: 5 }] as any;
    expect(await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Usage', undefined, tiers)).toMatchObject({
      actionError: expect.stringContaining('Rate tiers are not supported'),
    });
    expect(rowsOf('contract_template_line_service_configuration')).toHaveLength(0);
    await addServiceToContractLine('tl-1', 'svc-1', undefined, undefined, 'Usage');
    expect(await updateContractLineService('tl-1', 'svc-1', {}, tiers)).toMatchObject({
      actionError: expect.stringContaining('Rate tiers are not supported'),
    });
  });

  it('clears the stale type-specific row when a configuration changes type', async () => {
    seed('Hourly');
    const { ContractLineServiceConfigurationService } = await import(
      '../src/services/contractLineServiceConfigurationService'
    );
    const svc = new ContractLineServiceConfigurationService(trx, TENANT);
    const configId = await svc.upsertPlanServiceHourlyConfiguration('tl-1', 'svc-1', { hourly_rate: 100 });
    await svc.upsertPlanServiceUsageConfiguration('tl-1', 'svc-1', { unit_rate: 50, unit_of_measure: 'GB' });
    expect(rowsOf('contract_template_line_service_configuration')[0]).toMatchObject({ config_id: configId, configuration_type: 'Usage' });
    expect(rowsOf('contract_template_line_service_hourly_config')).toHaveLength(0);
    expect(rowsOf('contract_template_line_service_usage_config')).toHaveLength(1);
    await svc.updateTemplateConfiguration(configId, { configuration_type: 'Fixed' } as any);
    expect(rowsOf('contract_template_line_service_usage_config')).toHaveLength(0);
  });
});
