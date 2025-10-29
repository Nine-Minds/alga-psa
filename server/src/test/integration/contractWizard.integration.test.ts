import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('server/src/lib/actions/contractWizardActions').createClientContractFromWizard;
type CreatedIds = {
  serviceTypeId?: string;
  serviceId?: string;
  clientId?: string;
  contractId?: string;
  contractLineId?: string;
  clientContractId?: string;
  clientContractLineId?: string;
  clientServiceIds: string[];
  clientConfigIds: string[];
};
let createdIds: CreatedIds = { clientServiceIds: [], clientConfigIds: [] };

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
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
    ({ createClientContractFromWizard } = await import('server/src/lib/actions/contractWizardActions'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = { clientServiceIds: [], clientConfigIds: [] };
  });

  it('creates downstream client records for fixed-fee contracts', async () => {
    createdIds = { clientServiceIds: [], clientConfigIds: [] };
    const serviceTypeId = uuidv4();
    const serviceTypeName = `Managed Services ${serviceTypeId.slice(0, 8)}`;
    await db('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: serviceTypeName,
      billing_method: 'fixed',
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now().  
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
      company_id: clientId,
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
      .where({ tenant: tenantId, client_id: clientId })
      .first();
    expect(clientContract).toBeTruthy();
    createdIds.clientContractId = clientContract?.client_contract_id;

    const clientContractLine = await db('client_contract_lines')
      .where({ tenant: tenantId, contract_line_id: result.contract_line_id })
      .first();
    expect(clientContractLine).toBeTruthy();
    expect(clientContractLine?.client_contract_id).toBe(clientContract?.client_contract_id);
    createdIds.clientContractLineId = clientContractLine?.client_contract_line_id;

    const clientService = await db('client_contract_services')
      .where({ tenant: tenantId, client_contract_line_id: clientContractLine?.client_contract_line_id })
      .first();
    expect(clientService).toBeTruthy();
    expect(clientService?.service_id).toBe(serviceId);
    if (clientService?.client_contract_service_id) {
      createdIds.clientServiceIds.push(clientService.client_contract_service_id);
    }

    const clientConfig = await db('client_contract_service_configuration')
      .where({ tenant: tenantId, client_contract_service_id: clientService?.client_contract_service_id })
      .first();
    expect(clientConfig).toBeTruthy();
    expect(clientConfig?.configuration_type).toBe('Fixed');
    if (clientConfig?.config_id) {
      createdIds.clientConfigIds.push(clientConfig.config_id);
    }

    const fixedConfig = await db('client_contract_service_fixed_config')
      .where({ tenant: tenantId, config_id: clientConfig?.config_id })
      .first();
    expect(fixedConfig).toBeTruthy();
    expect(Number(fixedConfig?.base_rate ?? 0)).toBeCloseTo(100);
    expect(fixedConfig?.enable_proration).toBe(true);

  });
});

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

  await safeDeleteIn('client_contract_service_bucket_config', 'config_id', ids.clientConfigIds);
  await safeDeleteIn('client_contract_service_usage_config', 'config_id', ids.clientConfigIds);
  await safeDeleteIn('client_contract_service_rate_tiers', 'config_id', ids.clientConfigIds);
  await safeDeleteIn('client_contract_service_hourly_configs', 'config_id', ids.clientConfigIds);
  await safeDeleteIn('client_contract_service_hourly_config', 'config_id', ids.clientConfigIds);
  await safeDeleteIn('client_contract_service_fixed_config', 'config_id', ids.clientConfigIds);
  await safeDeleteIn('client_contract_service_configuration', 'config_id', ids.clientConfigIds);
  await safeDeleteIn('client_contract_services', 'client_contract_service_id', ids.clientServiceIds);

  if (ids.clientContractLineId) {
    await safeDelete('client_contract_lines', {
      tenant: tenantId,
      client_contract_line_id: ids.clientContractLineId
    });
  }

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
