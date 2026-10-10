import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { getContractMonthlyFixedValuesByContract } from '@alga-psa/shared/billingClients/contractMonthlyValue';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let getDraftContractForResume: typeof import('@alga-psa/billing/actions/contractWizardActions').getDraftContractForResume;
type CreatedIds = {
  serviceTypeId?: string;
  serviceId?: string;
  additionalServiceIds?: string[];
  clientId?: string;
  contractId?: string;
  contractLineId?: string;
  /** Extra lines for multi-line drafts, cleaned up alongside contractLineId. */
  contractLineIds?: string[];
  clientContractId?: string;
};
let createdIds: CreatedIds = {};

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function hasSchemaTable(connection: Knex, tableName: string): Promise<boolean> {
  const row = await tenantDb(connection, '__test_schema__')
    .unscoped('information_schema.tables', 'test schema table existence assertion')
    .where({ table_schema: 'public', table_name: tableName })
    .first('table_name');
  return Boolean(row);
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return null;
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    // A real transaction (a savepoint when already inside one) so rollback assertions mean something.
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      knexOrTrx.transaction((trx) => callback(trx)),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'contract-wizard-test-user',
          tenant: tenantId,
          roles: [{ role_name: 'Admin' }],
        } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

describe('createClientContractFromWizard', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, permissionCheck: () => true });
    ({ createClientContractFromWizard, getDraftContractForResume } = await import('@alga-psa/billing/actions/contractWizardActions'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = {};
  });

  it('creates downstream client records for fixed-fee contracts', async () => {
    createdIds = {};
    const serviceTypeId = uuidv4();
    const serviceTypeName = `Managed Services ${serviceTypeId.slice(0, 8)}`;
    await tenantTable(db, tenantId, 'service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: serviceTypeName,
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = uuidv4();
    await tenantTable(db, tenantId, 'service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: 'Emerald City Security',
      description: 'Managed service',
      default_rate: 10000,
      unit_of_measure: 'month',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    createdIds.serviceId = serviceId;

    const clientId = uuidv4();
    const clientName = `Emerald City ${clientId.slice(0, 8)}`;
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: clientName,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Emerald City Fixed Fee',
      description: 'Managed services',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: true,
      fixed_base_rate: 10000,
      fixed_services: [
        {
          service_id: serviceId,
          quantity: 1
        }
      ],
      hourly_services: [],
      usage_services: [],
      po_required: false
    });

    expect(result.contract_id).toBeDefined();
    expect(result.contract_line_id).toBeDefined();
    createdIds.contractId = result.contract_id;
    createdIds.contractLineId = result.contract_line_id ?? undefined;

    const clientContract = await tenantTable(db, tenantId, 'client_contracts')
      .where({ tenant: tenantId, client_id: clientId, contract_id: result.contract_id })
      .first();
    expect(clientContract).toBeTruthy();
    createdIds.clientContractId = clientContract?.client_contract_id;

    expect(await hasSchemaTable(db, 'client_contract_lines')).toBe(false);
    expect(await hasSchemaTable(db, 'client_contract_services')).toBe(false);

    const contractLine = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_line_id: result.contract_line_id })
      .first();
    expect(contractLine).toBeTruthy();
    expect(contractLine?.contract_id).toBe(result.contract_id);
    expect(contractLine?.enable_proration).toBe(true);

    const contractLineService = await tenantTable(db, tenantId, 'contract_line_services')
      .where({ tenant: tenantId, contract_line_id: result.contract_line_id, service_id: serviceId })
      .first();
    expect(contractLineService).toBeTruthy();

    const contractLineConfig = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({ tenant: tenantId, contract_line_id: result.contract_line_id, service_id: serviceId })
      .first();
    expect(contractLineConfig).toBeTruthy();
    expect(contractLineConfig?.configuration_type).toBe('Fixed');

    const fixedConfig = await tenantTable(db, tenantId, 'contract_line_service_fixed_config')
      .where({ tenant: tenantId, config_id: contractLineConfig?.config_id })
      .first();
    expect(fixedConfig).toBeTruthy();
    expect(Number(fixedConfig?.base_rate ?? 0)).toBe(10000);

  });

  it('bounds client-cadence service periods to an end-dated contract assignment', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'fixed');
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Bounded Client Cadence Service',
      billingMethod: 'fixed',
      itemKind: 'service',
      defaultRate: 10000,
      unitOfMeasure: 'month',
    });
    createdIds.serviceId = serviceId;

    const clientId = await insertClient(db, tenantId, 'Bounded Cadence Client');
    createdIds.clientId = clientId;

    const contractEnd = '2026-09-16';
    const result = await createClientContractFromWizard({
      contract_name: 'Bounded Client Cadence Contract',
      description: 'regression coverage for end-dated recurring periods',
      client_id: clientId,
      start_date: '2026-07-18',
      end_date: contractEnd,
      billing_frequency: 'monthly',
      cadence_owner: 'client',
      enable_proration: true,
      fixed_base_rate: 10000,
      fixed_services: [{ service_id: serviceId, quantity: 1 }],
      hourly_services: [],
      usage_services: [],
      po_required: false,
    });

    expect(result).not.toHaveProperty('actionError');
    if ('actionError' in result) {
      throw new Error(result.actionError);
    }

    createdIds.contractId = result.contract_id;
    createdIds.contractLineId = result.contract_line_id ?? undefined;
    const clientContract = await tenantTable(db, tenantId, 'client_contracts')
      .where({ tenant: tenantId, contract_id: result.contract_id, client_id: clientId })
      .first('client_contract_id');
    createdIds.clientContractId = clientContract?.client_contract_id;

    const periods = await tenantTable(db, tenantId, 'recurring_service_periods')
      .where({
        tenant: tenantId,
        obligation_id: result.contract_line_id,
        cadence_owner: 'client',
      })
      .whereNot('lifecycle_state', 'superseded')
      .orderBy('service_period_start', 'asc');

    expect(periods.length).toBeGreaterThan(0);
    expect(
      periods.every((period) => {
        const start = dateOnly(period.service_period_start);
        return start !== null && start < contractEnd;
      }),
    ).toBe(true);

    const straddlingPeriod = periods.find((period) => {
      const start = dateOnly(period.service_period_start);
      const end = dateOnly(period.service_period_end);
      return start !== null && end !== null && start < contractEnd && end > contractEnd;
    });
    expect(straddlingPeriod).toBeDefined();
    expect(dateOnly(straddlingPeriod?.activity_window_end)).toBe(contractEnd);
    expect(
      dateOnly(straddlingPeriod?.activity_window_start)! <
        dateOnly(straddlingPeriod?.activity_window_end)!,
    ).toBe(true);
  });

  it('T013: accepts fixed services even when catalog billing_method is non-fixed', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'hourly');
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Fixed Line Decoupled Service',
      billingMethod: 'hourly',
      itemKind: 'service',
      defaultRate: 7500,
      unitOfMeasure: 'month',
    });
    createdIds.serviceId = serviceId;

    const clientId = await insertClient(db, tenantId, 'Fixed Acceptance Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Fixed Decoupled Contract',
      description: 'accepts non-fixed catalog method',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: true,
      fixed_base_rate: 7500,
      fixed_services: [{ service_id: serviceId, quantity: 1 }],
      hourly_services: [],
      usage_services: [],
      po_required: false,
    });

    expect(result.contract_id).toBeDefined();
    createdIds.contractId = result.contract_id;
    createdIds.contractLineId = result.contract_line_id ?? undefined;
  });

  it('T014: rejects fixed-service submissions when selected catalog item is not a service', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'fixed');
    createdIds.serviceTypeId = serviceTypeId;

    const productId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Fixed Line Product',
      billingMethod: 'fixed',
      itemKind: 'product',
      defaultRate: 4200,
      unitOfMeasure: 'each',
    });
    createdIds.serviceId = productId;

    const clientId = await insertClient(db, tenantId, 'Fixed Rejection Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Fixed Product Rejection Contract',
      description: 'reject product in fixed services',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: true,
      fixed_base_rate: 4200,
      fixed_services: [{ service_id: productId, quantity: 1 }],
      hourly_services: [],
      usage_services: [],
      po_required: false,
    });

    expect(result).toMatchObject({
      actionError: 'Catalog item "Fixed Line Product" must be a service to be added to fixed fee contract lines.',
    });
  });

  it('T015: accepts hourly services even when catalog billing_method is non-hourly', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'usage');
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Hourly Line Decoupled Service',
      billingMethod: 'usage',
      itemKind: 'service',
      defaultRate: 6300,
      unitOfMeasure: 'hour',
    });
    createdIds.serviceId = serviceId;

    const clientId = await insertClient(db, tenantId, 'Hourly Acceptance Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Hourly Decoupled Contract',
      description: 'accepts non-hourly catalog method',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [{ service_id: serviceId, hourly_rate: 6300 }],
      usage_services: [],
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
      po_required: false,
    });

    expect(result.contract_id).toBeDefined();
    createdIds.contractId = result.contract_id;
    createdIds.contractLineId = result.contract_line_id ?? undefined;
  });

  it('T016: rejects hourly-service submissions when selected catalog item is not a service', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'hourly');
    createdIds.serviceTypeId = serviceTypeId;

    const productId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Hourly Line Product',
      billingMethod: 'hourly',
      itemKind: 'product',
      defaultRate: 3500,
      unitOfMeasure: 'each',
    });
    createdIds.serviceId = productId;

    const clientId = await insertClient(db, tenantId, 'Hourly Rejection Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Hourly Product Rejection Contract',
      description: 'reject product in hourly services',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [{ service_id: productId, hourly_rate: 3500 }],
      usage_services: [],
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
      po_required: false,
    });

    expect(result).toMatchObject({
      actionError: 'Catalog item "Hourly Line Product" must be a service to be added to hourly contract lines.',
    });
  });

  it('T017: accepts usage services even when catalog billing_method is non-usage', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'fixed');
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Usage Line Decoupled Service',
      billingMethod: 'fixed',
      itemKind: 'service',
      defaultRate: 2900,
      unitOfMeasure: 'unit',
    });
    createdIds.serviceId = serviceId;

    const clientId = await insertClient(db, tenantId, 'Usage Acceptance Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Usage Decoupled Contract',
      description: 'accepts non-usage catalog method',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [],
      usage_services: [{ service_id: serviceId, unit_rate: 2900, unit_of_measure: 'unit' }],
      po_required: false,
    });

    expect(result.contract_id).toBeDefined();
    createdIds.contractId = result.contract_id;
    createdIds.contractLineId = result.contract_line_id ?? undefined;
  });

  it('T018: rejects usage-service submissions when selected catalog item is not a service', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'usage');
    createdIds.serviceTypeId = serviceTypeId;

    const productId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Usage Line Product',
      billingMethod: 'usage',
      itemKind: 'product',
      defaultRate: 1800,
      unitOfMeasure: 'each',
    });
    createdIds.serviceId = productId;

    const clientId = await insertClient(db, tenantId, 'Usage Rejection Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Usage Product Rejection Contract',
      description: 'reject product in usage services',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [],
      usage_services: [{ service_id: productId, unit_rate: 1800, unit_of_measure: 'unit' }],
      po_required: false,
    });

    expect(result).toMatchObject({
      actionError: 'Catalog item "Usage Line Product" must be a service to be added to usage contract lines.',
    });
  });

  it('T021: resolves fixed-mode prefill from service+mode+currency defaults when no fixed override is provided', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'hourly');
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Fixed Mode Default Service',
      billingMethod: 'hourly',
      itemKind: 'service',
      defaultRate: 4100,
      unitOfMeasure: 'month',
    });
    createdIds.serviceId = serviceId;

    await insertModeDefault(db, {
      tenant: tenantId,
      serviceId,
      billingMode: 'fixed',
      currencyCode: 'USD',
      rate: 9900,
    });

    const clientId = await insertClient(db, tenantId, 'Fixed Mode Default Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Fixed Mode Default Contract',
      description: 'uses fixed mode defaults',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: true,
      fixed_services: [{ service_id: serviceId, quantity: 1 }],
      hourly_services: [],
      usage_services: [],
      po_required: false,
    });
    createdIds.contractId = result.contract_id;

    const fixedLine = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: result.contract_id, contract_line_type: 'Fixed' })
      .first();
    expect(fixedLine).toBeTruthy();

    const config = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .where({
        tenant: tenantId,
        contract_line_id: fixedLine!.contract_line_id,
        service_id: serviceId,
        configuration_type: 'Fixed',
      })
      .first();
    expect(config).toBeTruthy();

    const fixedConfig = await tenantTable(db, tenantId, 'contract_line_service_fixed_config')
      .where({ tenant: tenantId, config_id: config!.config_id })
      .first();
    expect(Number(fixedConfig?.base_rate ?? 0)).toBe(9900);
  });

  it('T022: resolves hourly-mode prefill from service+mode+currency defaults when no hourly override is provided', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'fixed');
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Hourly Mode Default Service',
      billingMethod: 'fixed',
      itemKind: 'service',
      defaultRate: 3500,
      unitOfMeasure: 'hour',
    });
    createdIds.serviceId = serviceId;

    await insertModeDefault(db, {
      tenant: tenantId,
      serviceId,
      billingMode: 'hourly',
      currencyCode: 'USD',
      rate: 8700,
    });

    const clientId = await insertClient(db, tenantId, 'Hourly Mode Default Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Hourly Mode Default Contract',
      description: 'uses hourly mode defaults',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [{ service_id: serviceId }],
      usage_services: [],
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
      po_required: false,
    });
    createdIds.contractId = result.contract_id;

    const hourlyLine = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: result.contract_id, contract_line_type: 'Hourly' })
      .first();
    expect(hourlyLine).toBeTruthy();

    expect(await readHourlyRate(db, tenantId, hourlyLine!.contract_line_id, serviceId)).toBe(8700);
  });

  it('T023: resolves usage-mode prefill from service+mode+currency defaults when no usage override is provided', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'hourly');
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Usage Mode Default Service',
      billingMethod: 'hourly',
      itemKind: 'service',
      defaultRate: 2300,
      unitOfMeasure: 'unit',
    });
    createdIds.serviceId = serviceId;

    await insertModeDefault(db, {
      tenant: tenantId,
      serviceId,
      billingMode: 'usage',
      currencyCode: 'USD',
      rate: 6400,
    });

    const clientId = await insertClient(db, tenantId, 'Usage Mode Default Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Usage Mode Default Contract',
      description: 'uses usage mode defaults',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [],
      usage_services: [{ service_id: serviceId, unit_of_measure: 'unit' }],
      po_required: false,
    });
    createdIds.contractId = result.contract_id;

    const usageLine = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: result.contract_id, contract_line_type: 'Usage' })
      .first();
    expect(usageLine).toBeTruthy();

    expect(await readUsageRate(db, tenantId, usageLine!.contract_line_id, serviceId)).toBe(6400);
  });

  it('T024: explicit fixed/hourly/usage overrides supersede catalog mode defaults', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'usage');
    createdIds.serviceTypeId = serviceTypeId;

    const fixedServiceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Fixed Override Service',
      billingMethod: 'hourly',
      itemKind: 'service',
      defaultRate: 1200,
      unitOfMeasure: 'month',
    });
    const hourlyServiceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Hourly Override Service',
      billingMethod: 'usage',
      itemKind: 'service',
      defaultRate: 1300,
      unitOfMeasure: 'hour',
    });
    const usageServiceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Usage Override Service',
      billingMethod: 'fixed',
      itemKind: 'service',
      defaultRate: 1400,
      unitOfMeasure: 'unit',
    });
    createdIds.serviceId = fixedServiceId;
    createdIds.additionalServiceIds = [hourlyServiceId, usageServiceId];

    await insertModeDefault(db, {
      tenant: tenantId,
      serviceId: fixedServiceId,
      billingMode: 'fixed',
      currencyCode: 'USD',
      rate: 9500,
    });
    await insertModeDefault(db, {
      tenant: tenantId,
      serviceId: hourlyServiceId,
      billingMode: 'hourly',
      currencyCode: 'USD',
      rate: 9600,
    });
    await insertModeDefault(db, {
      tenant: tenantId,
      serviceId: usageServiceId,
      billingMode: 'usage',
      currencyCode: 'USD',
      rate: 9700,
    });

    const clientId = await insertClient(db, tenantId, 'Explicit Override Client');
    createdIds.clientId = clientId;

    const result = await createClientContractFromWizard({
      contract_name: 'Explicit Override Contract',
      description: 'explicit values beat mode defaults',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: true,
      fixed_base_rate: 7777,
      fixed_services: [{ service_id: fixedServiceId, quantity: 1 }],
      hourly_services: [{ service_id: hourlyServiceId, hourly_rate: 8888 }],
      usage_services: [{ service_id: usageServiceId, unit_rate: 9999, unit_of_measure: 'unit' }],
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
      po_required: false,
    });
    createdIds.contractId = result.contract_id;

    const lines = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: result.contract_id })
      .select('contract_line_id', 'contract_line_type');
    const lineIdByType = new Map(lines.map((line) => [line.contract_line_type, line.contract_line_id]));

    const fixedConfig = await tenantDb(db, tenantId)
      .tenantJoin(
        tenantTable(db, tenantId, 'contract_line_service_fixed_config'),
        'contract_line_service_configuration as cfg',
        'contract_line_service_fixed_config.config_id',
        'cfg.config_id'
      )
      .where({
        'contract_line_service_fixed_config.tenant': tenantId,
        'cfg.contract_line_id': lineIdByType.get('Fixed'),
        'cfg.service_id': fixedServiceId,
      })
      .first('contract_line_service_fixed_config.base_rate');
    expect(Number(fixedConfig?.base_rate ?? 0)).toBe(7777);

    expect(await readHourlyRate(db, tenantId, lineIdByType.get('Hourly')!, hourlyServiceId)).toBe(8888);
    expect(await readUsageRate(db, tenantId, lineIdByType.get('Usage')!, usageServiceId)).toBe(9999);
  });

  // alga0002268: finalizing a draft rebuilds its lines, which deletes the old
  // contract_line_service_configuration rows. Three child tables were never cleared first —
  // contract_line_service_fixed_config, contract_line_service_hourly_configs and
  // contract_line_service_rate_tiers — so production (which carries NO ACTION FKs on all
  // three) raised 23503 and the wizard refused to finish. The orphan assertion below is what
  // catches a regression on CI schemas that still lack those FKs.
  it('T027: finalizing a draft clears every config child table before rebuilding its lines', async () => {
    createdIds = {};
    const serviceTypeId = await insertServiceType(db, tenantId, 'fixed');
    createdIds.serviceTypeId = serviceTypeId;

    const fixedServiceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Rivermark Managed Fixed',
      billingMethod: 'fixed',
      itemKind: 'service',
      defaultRate: 5000,
      unitOfMeasure: 'month',
    });
    const hourlyServiceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Rivermark Managed Hourly',
      billingMethod: 'hourly',
      itemKind: 'service',
      defaultRate: 15000,
      unitOfMeasure: 'hour',
    });
    const usageServiceId = await insertCatalogItem(db, tenantId, {
      serviceTypeId,
      serviceName: 'Rivermark Managed Usage',
      billingMethod: 'usage',
      itemKind: 'service',
      defaultRate: 250,
      unitOfMeasure: 'unit',
    });
    createdIds.serviceId = fixedServiceId;
    createdIds.additionalServiceIds = [hourlyServiceId, usageServiceId];

    const clientId = await insertClient(db, tenantId, 'Rivermark Credit Union');
    createdIds.clientId = clientId;

    const submission = {
      contract_name: 'Managed services agreement',
      description: 'converted from quote',
      client_id: clientId,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: true,
      fixed_base_rate: 5000,
      fixed_services: [{ service_id: fixedServiceId, quantity: 1 }],
      hourly_services: [{ service_id: hourlyServiceId, hourly_rate: 15000 }],
      usage_services: [{ service_id: usageServiceId, unit_rate: 250, unit_of_measure: 'unit' }],
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
      po_required: false,
    } as any;

    // Seed the draft the way a quote conversion leaves it.
    const draft = await createClientContractFromWizard(submission, { isDraft: true });
    expect('contract_id' in draft).toBe(true);
    const contractId = (draft as { contract_id: string }).contract_id;
    createdIds.contractId = contractId;

    const draftLineIds = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: contractId })
      .pluck('contract_line_id');
    expect(draftLineIds.length).toBeGreaterThan(1);
    createdIds.contractLineIds = draftLineIds;

    const draftConfigs = await tenantTable(db, tenantId, 'contract_line_service_configuration')
      .whereIn('contract_line_id', draftLineIds)
      .select('config_id', 'configuration_type');
    const draftConfigIds = draftConfigs.map((row) => row.config_id as string);
    expect(draftConfigIds.length).toBeGreaterThan(0);

    // A quote-converted draft carries an active assignment, unlike a wizard-saved draft.
    await tenantTable(db, tenantId, 'client_contracts')
      .where({ tenant: tenantId, contract_id: contractId })
      .update({ is_active: true });

    // Tiers only exist on usage configs, and the wizard does not author them, so the
    // quote-conversion shape has to be seeded explicitly.
    const usageConfigId = draftConfigs.find((row) => row.configuration_type === 'Usage')?.config_id;
    expect(usageConfigId).toBeTruthy();
    await tenantTable(db, tenantId, 'contract_line_service_rate_tiers').insert({
      tier_id: uuidv4(),
      tenant: tenantId,
      config_id: usageConfigId,
      min_quantity: 1,
      max_quantity: 100,
      rate: 250,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // All three previously-missed tables must be populated, or the test proves nothing.
    const seededCounts = await Promise.all(
      ['contract_line_service_fixed_config', 'contract_line_service_hourly_configs', 'contract_line_service_rate_tiers']
        .map(async (table) => (await tenantTable(db, tenantId, table).whereIn('config_id', draftConfigIds)).length)
    );
    for (const count of seededCounts) {
      expect(count).toBeGreaterThan(0);
    }

    // Finish Setup: same submission, now carrying the draft's contract_id.
    // Without the child-table deletes this returns the 23503 action error instead of a
    // contract, which is the toast the ticket reported.
    const finalized = await createClientContractFromWizard({ ...submission, contract_id: contractId });
    expect(
      'contract_id' in finalized ? null : finalized,
      'finalize returned an action error instead of a contract',
    ).toBeNull();
    expect((finalized as { contract_id: string }).contract_id).toBe(contractId);

    const finalLineIds = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: contractId })
      .pluck('contract_line_id');
    createdIds.contractLineIds = [...new Set([...draftLineIds, ...finalLineIds])];

    const contract = await tenantTable(db, tenantId, 'contracts')
      .where({ tenant: tenantId, contract_id: contractId })
      .first('status', 'is_active');
    expect(contract?.status).toBe('active');
    expect(contract?.is_active).toBe(true);

    const clientContract = await tenantTable(db, tenantId, 'client_contracts')
      .where({ tenant: tenantId, contract_id: contractId })
      .first('client_contract_id');
    expect(clientContract).toBeTruthy();
    createdIds.clientContractId = clientContract?.client_contract_id;

    // No child row may outlive its deleted parent configuration.
    for (const table of [
      'contract_line_service_configuration',
      'contract_line_service_fixed_config',
      'contract_line_service_hourly_configs',
      'contract_line_service_hourly_config',
      'contract_line_service_rate_tiers',
      'contract_line_service_bucket_config',
      'contract_line_service_usage_config',
    ]) {
      const leftovers = await tenantTable(db, tenantId, table).whereIn('config_id', draftConfigIds);
      expect(leftovers, `${table} kept rows for the draft's old config_ids`).toHaveLength(0);
    }
  });

  describe('finalize preserves recurring totals', () => {
    // Lines are rebuilt with new ids on every finalize, so sweep whatever the contract holds now.
    afterEach(async () => {
      if (createdIds.contractId) {
        createdIds.contractLineIds = await tenantTable(db, tenantId, 'contract_lines')
          .where({ tenant: tenantId, contract_id: createdIds.contractId })
          .pluck('contract_line_id');
      }
    });

    const monthlyOf = async (contractId: string) =>
      (await getContractMonthlyFixedValuesByContract(db, tenantId, [contractId])).get(contractId)?.monthlyValueCents ?? 0;

    const linesOf = (contractId: string) =>
      tenantTable<any>(db, tenantId, 'contract_lines')
        .where({ tenant: tenantId, contract_id: contractId, contract_line_type: 'Fixed' })
        .orderBy('custom_rate', 'desc');

    const seedServices = async (names: string[], defaultRate = 1000) => {
      const serviceTypeId = await insertServiceType(db, tenantId, 'fixed');
      createdIds.serviceTypeId = serviceTypeId;
      const ids: string[] = [];
      for (const name of names) {
        ids.push(
          await insertCatalogItem(db, tenantId, {
            serviceTypeId,
            serviceName: `${name} ${serviceTypeId.slice(0, 6)}`,
            billingMethod: 'fixed',
            itemKind: 'service',
            defaultRate,
            unitOfMeasure: 'month',
          }),
        );
      }
      createdIds.serviceId = ids[0];
      createdIds.additionalServiceIds = ids.slice(1);
      createdIds.clientId = await insertClient(db, tenantId, 'Recurring Totals');
      return ids;
    };

    const baseSubmission = () => ({
      contract_name: 'Recurring totals',
      client_id: createdIds.clientId!,
      start_date: '2025-10-01',
      end_date: null,
      billing_frequency: 'monthly',
      enable_proration: false,
      hourly_services: [],
      usage_services: [],
      po_required: false,
    });

    const seedDraft = async (fixed_lines: any[]) => {
      const draft = await createClientContractFromWizard(
        { ...baseSubmission(), fixed_lines } as any,
        { isDraft: true },
      );
      expect('contract_id' in draft).toBe(true);
      const contractId = (draft as { contract_id: string }).contract_id;
      createdIds.contractId = contractId;
      return contractId;
    };

    const resumeAsSubmission = async (contractId: string, overrides: Record<string, unknown> = {}) => {
      const resumed: any = await getDraftContractForResume(contractId);
      expect(resumed.is_draft).toBe(true);
      const { is_draft, recurring_baseline, template_id, ...rest } = resumed;
      return { submission: { ...rest, contract_id: contractId, ...overrides } as any, resumed };
    };

    it('1: two bundle lines at different rates resume and finalize with the same total and lines', async () => {
      const [a, b, c] = await seedServices(['Bundle A', 'Bundle B', 'Bundle C']);
      const contractId = await seedDraft([
        { line_key: 'l1', contract_line_name: 'Core', enable_proration: false, base_rate: 300000,
          services: [{ service_id: a, quantity: 1, pricing_basis: 'bundle' }, { service_id: b, quantity: 1, pricing_basis: 'bundle' }] },
        { line_key: 'l2', contract_line_name: 'Extras', enable_proration: false, base_rate: 105000,
          services: [{ service_id: c, quantity: 1, pricing_basis: 'bundle' }] },
      ]);
      expect(await monthlyOf(contractId)).toBe(405000);

      const { submission, resumed } = await resumeAsSubmission(contractId);
      expect(resumed.fixed_lines).toHaveLength(2);
      expect(resumed.recurring_baseline.monthly_cents).toBe(405000);

      const result = await createClientContractFromWizard(submission, { isDraft: true });
      expect('contract_id' in result).toBe(true);

      const lines = await linesOf(contractId);
      expect(lines.map((l: any) => Number(l.custom_rate))).toEqual([300000, 105000]);
      expect(await monthlyOf(contractId)).toBe(405000);
      const members = await tenantTable(db, tenantId, 'contract_line_services')
        .whereIn('contract_line_id', lines.map((l: any) => l.contract_line_id))
        .select('contract_line_id', 'service_id');
      expect(members.filter((m: any) => m.contract_line_id === lines[0].contract_line_id)).toHaveLength(2);
      expect(members.filter((m: any) => m.contract_line_id === lines[1].contract_line_id)).toHaveLength(1);
    });

    it('2: a service-less custom line is refused on Finish (rolled back) and kept by Save Draft', async () => {
      await seedServices(['Unused']);
      const contractId = await seedDraft([
        { line_key: 'custom', contract_line_name: 'Custom retainer', enable_proration: false, base_rate: 70000, services: [] },
      ]);
      const before = await linesOf(contractId);
      expect(before).toHaveLength(1);
      expect(Number(before[0].custom_rate)).toBe(70000);

      const { submission, resumed } = await resumeAsSubmission(contractId);
      expect(resumed.fixed_lines[0].services).toEqual([]);
      expect(resumed.fixed_lines[0].base_rate).toBe(70000);

      const refused: any = await createClientContractFromWizard(submission);
      expect(JSON.stringify(refused)).toMatch(/Custom retainer/);
      const afterRefusal = await linesOf(contractId);
      expect(afterRefusal.map((l: any) => l.contract_line_id)).toEqual(before.map((l: any) => l.contract_line_id));

      const saved = await createClientContractFromWizard(submission, { isDraft: true });
      expect('contract_id' in saved).toBe(true);
      const afterSave = await linesOf(contractId);
      expect(afterSave).toHaveLength(1);
      expect(Number(afterSave[0].custom_rate)).toBe(70000);
      expect(await monthlyOf(contractId)).toBe(70000);
    });

    it('3: a mixed unit + bundle line plus a second bundle line keep their totals', async () => {
      const [seat, bundle, other] = await seedServices(['Seat', 'Bundle', 'Other']);
      const contractId = await seedDraft([
        { line_key: 'mix', contract_line_name: 'Mixed', enable_proration: false, base_rate: 50000,
          services: [
            { service_id: seat, quantity: 5, pricing_basis: 'unit', unit_rate: 15000 },
            { service_id: bundle, quantity: 1, pricing_basis: 'bundle' },
          ] },
        { line_key: 'o', contract_line_name: 'Other', enable_proration: false, base_rate: 20000,
          services: [{ service_id: other, quantity: 1, pricing_basis: 'bundle' }] },
      ]);
      const total = await monthlyOf(contractId);
      expect(total).toBe(145000);

      const { submission } = await resumeAsSubmission(contractId);
      const result = await createClientContractFromWizard(submission, { isDraft: true });
      expect('contract_id' in result).toBe(true);
      expect(await monthlyOf(contractId)).toBe(total);
      expect(await linesOf(contractId)).toHaveLength(2);
    });

    it('4: a Rivermark per-seat shape (3 unit lines, $4,200/mo) is unchanged after resume + finalize', async () => {
      const [x, y, z] = await seedServices(['Seat X', 'Seat Y', 'Seat Z']);
      const contractId = await seedDraft([
        { line_key: 'a', contract_line_name: 'Seats X', enable_proration: false, base_rate: null,
          services: [{ service_id: x, quantity: 10, pricing_basis: 'unit', unit_rate: 20000 }] },
        { line_key: 'b', contract_line_name: 'Seats Y', enable_proration: false, base_rate: null,
          services: [{ service_id: y, quantity: 8, pricing_basis: 'unit', unit_rate: 10000 }] },
        { line_key: 'c', contract_line_name: 'Seats Z', enable_proration: false, base_rate: null,
          services: [{ service_id: z, quantity: 4, pricing_basis: 'unit', unit_rate: 35000 }] },
      ]);
      expect(await monthlyOf(contractId)).toBe(420000);

      const { submission, resumed } = await resumeAsSubmission(contractId);
      expect(resumed.fixed_lines).toHaveLength(3);
      const result = await createClientContractFromWizard(submission);
      expect('contract_id' in result).toBe(true);
      expect(await linesOf(contractId)).toHaveLength(3);
      expect(await monthlyOf(contractId)).toBe(420000);
    });

    it('5: the guard asks for confirmation on a changed total, commits with a matching ack, refuses a stale one', async () => {
      const [a] = await seedServices(['Guarded']);
      const contractId = await seedDraft([
        { line_key: 'l1', contract_line_name: 'Guarded', enable_proration: false, base_rate: 100000,
          services: [{ service_id: a, quantity: 1, pricing_basis: 'bundle' }] },
      ]);
      const { submission, resumed } = await resumeAsSubmission(contractId);
      const lowered = { ...submission, fixed_lines: [{ ...resumed.fixed_lines[0], base_rate: 80000 }] };
      const originalLineIds = (await linesOf(contractId)).map((l: any) => l.contract_line_id);

      const asked: any = await createClientContractFromWizard(lowered, { isDraft: true });
      expect(asked).toEqual({
        confirmation_required: 'recurring_total_change',
        baseline_monthly_cents: 100000,
        resulting_monthly_cents: 80000,
      });
      // Rolled back: same line ids, same total.
      expect((await linesOf(contractId)).map((l: any) => l.contract_line_id)).toEqual(originalLineIds);
      expect(await monthlyOf(contractId)).toBe(100000);

      const stale: any = await createClientContractFromWizard(
        { ...lowered, recurring_change_ack: { baseline_monthly_cents: 90000 } },
        { isDraft: true },
      );
      expect(stale.confirmation_required).toBe('recurring_total_change');
      expect(await monthlyOf(contractId)).toBe(100000);

      const ok: any = await createClientContractFromWizard(
        { ...lowered, recurring_change_ack: { baseline_monthly_cents: 100000 } },
        { isDraft: true },
      );
      expect('contract_id' in ok).toBe(true);
      expect(await monthlyOf(contractId)).toBe(80000);
    });

    it('6: the legacy fixed_services + fixed_base_rate shape still creates one line; supplying both shapes is rejected', async () => {
      const [a] = await seedServices(['Legacy']);
      const legacy: any = await createClientContractFromWizard(
        { ...baseSubmission(), fixed_base_rate: 40000, fixed_services: [{ service_id: a, quantity: 1 }] } as any,
        { isDraft: true },
      );
      expect('contract_id' in legacy).toBe(true);
      createdIds.contractId = legacy.contract_id;
      expect(await linesOf(legacy.contract_id)).toHaveLength(1);
      expect(await monthlyOf(legacy.contract_id)).toBe(40000);

      const both: any = await createClientContractFromWizard(
        {
          ...baseSubmission(),
          fixed_base_rate: 40000,
          fixed_services: [{ service_id: a, quantity: 1 }],
          fixed_lines: [{ line_key: 'x', enable_proration: false, base_rate: 1, services: [{ service_id: a, quantity: 1, pricing_basis: 'bundle' }] }],
        } as any,
        { isDraft: true },
      );
      expect('contract_id' in both).toBe(false);
      expect(JSON.stringify(both)).toMatch(/not both/);
    });
  });
});

// The wizard persists resolved hourly rates on contract_line_service_hourly_configs
// (keyed by the line+service configuration) and resolved usage unit rates on the
// configuration row's custom_rate.
async function readHourlyRate(connection: Knex, tenant: string, contractLineId: string, serviceId: string) {
  const config = await tenantTable(connection, tenant, 'contract_line_service_configuration')
    .where({ tenant, contract_line_id: contractLineId, service_id: serviceId })
    .first('config_id');
  const hourlyConfig = await tenantTable(connection, tenant, 'contract_line_service_hourly_configs')
    .where({ tenant, config_id: config?.config_id })
    .first('hourly_rate');
  return Number(hourlyConfig?.hourly_rate ?? 0);
}

async function readUsageRate(connection: Knex, tenant: string, contractLineId: string, serviceId: string) {
  const config = await tenantTable(connection, tenant, 'contract_line_service_configuration')
    .where({ tenant, contract_line_id: contractLineId, service_id: serviceId })
    .first('custom_rate');
  return Number(config?.custom_rate ?? 0);
}

async function insertServiceType(connection: Knex, tenant: string, billingMethod: 'fixed' | 'hourly' | 'usage') {
  const serviceTypeId = uuidv4();
  await tenantTable(connection, tenant, 'service_types').insert({
    id: serviceTypeId,
    tenant,
    name: `Service Type ${serviceTypeId.slice(0, 8)}`,
    order_number: Math.floor(Math.random() * 1000000),
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return serviceTypeId;
}

async function insertCatalogItem(
  connection: Knex,
  tenant: string,
  options: {
    serviceTypeId: string;
    serviceName: string;
    billingMethod: 'fixed' | 'hourly' | 'usage';
    itemKind: 'service' | 'product';
    defaultRate: number;
    unitOfMeasure: string;
  }
) {
  const serviceId = uuidv4();
  await tenantTable(connection, tenant, 'service_catalog').insert({
    tenant,
    service_id: serviceId,
    service_name: options.serviceName,
    description: 'Contract wizard integration item',
    default_rate: options.defaultRate,
    unit_of_measure: options.unitOfMeasure,
    billing_method: options.billingMethod,
    custom_service_type_id: options.serviceTypeId,
    tax_rate_id: null,
    category_id: null,
    item_kind: options.itemKind,
  });
  return serviceId;
}

async function insertClient(connection: Knex, tenant: string, clientNamePrefix: string) {
  const clientId = uuidv4();
  await tenantTable(connection, tenant, 'clients').insert({
    tenant,
    client_id: clientId,
    client_name: `${clientNamePrefix} ${clientId.slice(0, 8)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return clientId;
}

async function insertModeDefault(
  connection: Knex,
  params: {
    tenant: string;
    serviceId: string;
    billingMode: 'fixed' | 'hourly' | 'usage';
    currencyCode: string;
    rate: number;
  }
) {
  await tenantTable(connection, params.tenant, 'service_catalog_mode_defaults').insert({
    tenant: params.tenant,
    service_id: params.serviceId,
    billing_mode: params.billingMode,
    currency_code: params.currencyCode,
    rate: params.rate,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
}

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Contract Wizard Integration Tenant',
    email: 'contract-wizard@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}

async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds) {
  if (!ids) {
    return;
  }

  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await tenantTable(db, tenantId, table).where(where).del();
    } catch {
      // ignore cleanup issues
    }
  };

  const safeDeleteIn = async (table: string, column: string, values: string[]) => {
    if (!values || values.length === 0) {
      return;
    }
    try {
      await tenantTable(db, tenantId, table).whereIn(column, values).del();
    } catch {
      // ignore cleanup issues
    }
  };

  if (ids.clientContractId) {
    await safeDelete('client_contracts', {
      tenant: tenantId,
      client_contract_id: ids.clientContractId
    });
  }

  // Config children are keyed by config_id, not contract_line_id, so they have to be cleared
  // through their parent configuration rows — otherwise the composite FKs block the parent
  // delete and the rows survive the suite.
  const allLineIds = [
    ...(ids.contractLineId ? [ids.contractLineId] : []),
    ...(ids.contractLineIds ?? []),
  ];
  if (allLineIds.length > 0) {
    let configIds: string[] = [];
    try {
      configIds = await tenantTable(db, tenantId, 'contract_line_service_configuration')
        .whereIn('contract_line_id', allLineIds)
        .pluck('config_id');
    } catch {
      // ignore cleanup issues
    }
    for (const table of [
      'contract_line_service_rate_tiers',
      'contract_line_service_fixed_config',
      'contract_line_service_hourly_configs',
      'contract_line_service_hourly_config',
      'contract_line_service_bucket_config',
      'contract_line_service_usage_config',
    ]) {
      await safeDeleteIn(table, 'config_id', configIds);
    }
    for (const table of [
      'contract_line_service_configuration',
      'contract_line_service_defaults',
      'contract_line_services',
      'contract_lines',
    ]) {
      await safeDeleteIn(table, 'contract_line_id', allLineIds);
    }
  }

  if (ids.contractLineId) {
    await safeDelete('recurring_service_periods', {
      tenant: tenantId,
      obligation_id: ids.contractLineId,
    });
    await safeDelete('contract_line_service_bucket_config', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
    await safeDelete('contract_line_service_usage_config', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
    await safeDelete('contract_line_service_rate_tiers', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
    await safeDelete('contract_line_service_hourly_configs', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
    await safeDelete('contract_line_service_hourly_config', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
    await safeDelete('contract_line_service_fixed_config', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
    await safeDelete('contract_line_service_configuration', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
    await safeDelete('contract_line_services', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
    await safeDelete('contract_lines', {
      tenant: tenantId,
      contract_line_id: ids.contractLineId
    });
  }

  if (ids.contractId) {
    await safeDelete('contracts', {
      tenant: tenantId,
      contract_id: ids.contractId
    });
  }

  if (ids.clientId) {
    await safeDelete('client_billing_cycles', {
      tenant: tenantId,
      client_id: ids.clientId
    });
    await safeDelete('clients', {
      tenant: tenantId,
      client_id: ids.clientId
    });
  }

  if (ids.serviceId) {
    await safeDelete('service_catalog_mode_defaults', {
      tenant: tenantId,
      service_id: ids.serviceId
    });
    await safeDelete('usage_tracking', {
      tenant: tenantId,
      service_id: ids.serviceId
    });
    await safeDelete('service_catalog', {
      tenant: tenantId,
      service_id: ids.serviceId
    });
  }

  if (ids.additionalServiceIds && ids.additionalServiceIds.length > 0) {
    await safeDeleteIn('service_catalog_mode_defaults', 'service_id', ids.additionalServiceIds);
    await safeDeleteIn('usage_tracking', 'service_id', ids.additionalServiceIds);
    await safeDeleteIn('service_catalog', 'service_id', ids.additionalServiceIds);
  }

  if (ids.serviceTypeId) {
    await safeDelete('service_types', {
      tenant: tenantId,
      id: ids.serviceTypeId
    });
  }
}
