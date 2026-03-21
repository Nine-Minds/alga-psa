import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
type CreatedIds = {
  serviceTypeId?: string;
  serviceId?: string;
  clientId?: string;
  contractId?: string;
  contractLineId?: string;
  clientContractId?: string;
};
let createdIds: CreatedIds = {};

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
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
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
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, permissionCheck: () => true });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
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
    await db('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: serviceTypeName,
      billing_method: 'fixed',
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = uuidv4();
    await db('service_catalog').insert({
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
    await db('clients').insert({
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

    const clientContract = await db('client_contracts')
      .where({ tenant: tenantId, client_id: clientId, contract_id: result.contract_id })
      .first();
    expect(clientContract).toBeTruthy();
    createdIds.clientContractId = clientContract?.client_contract_id;

    expect(await db.schema.hasTable('client_contract_lines')).toBe(false);
    expect(await db.schema.hasTable('client_contract_services')).toBe(false);

    const contractLine = await db('contract_lines')
      .where({ tenant: tenantId, contract_line_id: result.contract_line_id })
      .first();
    expect(contractLine).toBeTruthy();
    expect(contractLine?.contract_id).toBe(result.contract_id);
    expect(contractLine?.enable_proration).toBe(true);

    const contractLineService = await db('contract_line_services')
      .where({ tenant: tenantId, contract_line_id: result.contract_line_id, service_id: serviceId })
      .first();
    expect(contractLineService).toBeTruthy();

    const contractLineConfig = await db('contract_line_service_configuration')
      .where({ tenant: tenantId, contract_line_id: result.contract_line_id, service_id: serviceId })
      .first();
    expect(contractLineConfig).toBeTruthy();
    expect(contractLineConfig?.configuration_type).toBe('Fixed');

    const fixedConfig = await db('contract_line_service_fixed_config')
      .where({ tenant: tenantId, config_id: contractLineConfig?.config_id })
      .first();
    expect(fixedConfig).toBeTruthy();
    expect(Number(fixedConfig?.base_rate ?? 0)).toBe(10000);

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

    await expect(
      createClientContractFromWizard({
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
      })
    ).rejects.toThrow('must be a service to be added to fixed fee contract lines');
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

    await expect(
      createClientContractFromWizard({
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
      })
    ).rejects.toThrow('must be a service to be added to hourly contract lines');
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

    await expect(
      createClientContractFromWizard({
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
      })
    ).rejects.toThrow('must be a service to be added to usage contract lines');
  });
});

async function insertServiceType(connection: Knex, tenant: string, billingMethod: 'fixed' | 'hourly' | 'usage') {
  const serviceTypeId = uuidv4();
  await connection('service_types').insert({
    id: serviceTypeId,
    tenant,
    name: `Service Type ${serviceTypeId.slice(0, 8)}`,
    billing_method: billingMethod,
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
  await connection('service_catalog').insert({
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
  await connection('clients').insert({
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

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants').first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
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
      await db(table).where(where).del();
    } catch {
      // ignore cleanup issues
    }
  };

  const safeDeleteIn = async (table: string, column: string, values: string[]) => {
    if (!values || values.length === 0) {
      return;
    }
    try {
      await db(table).whereIn(column, values).andWhere({ tenant: tenantId }).del();
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

  if (ids.contractLineId) {
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
    await safeDelete('usage_tracking', {
      tenant: tenantId,
      service_id: ids.serviceId
    });
    await safeDelete('service_catalog', {
      tenant: tenantId,
      service_id: ids.serviceId
    });
  }

  if (ids.serviceTypeId) {
    await safeDelete('service_types', {
      tenant: tenantId,
      id: ids.serviceTypeId
    });
  }
}
