import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let createContractTemplateFromWizard: typeof import('server/src/lib/actions/contractWizardActions').createContractTemplateFromWizard;
let createClientContractFromWizard: typeof import('server/src/lib/actions/contractWizardActions').createClientContractFromWizard;
let getContractTemplateSnapshotForClientWizard: typeof import('server/src/lib/actions/contractWizardActions').getContractTemplateSnapshotForClientWizard;

type CreatedIds = {
  serviceTypeId?: string;
  serviceId?: string;
  templateIds: string[];
  contractLineIds: string[];
  contractIds: string[];
  clientId?: string;
};

let createdIds: CreatedIds = { templateIds: [], contractLineIds: [], contractIds: [] };

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

describe('createContractTemplateFromWizard with Currency Support', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    process.env.E2E_AUTH_BYPASS = 'true';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, permissionCheck: () => true });
    ({ createContractTemplateFromWizard, createClientContractFromWizard, getContractTemplateSnapshotForClientWizard } = await import('server/src/lib/actions/contractWizardActions'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = { templateIds: [], contractLineIds: [], contractIds: [] };
  });

  it('creates a template with USD currency and persists it correctly', async () => {
    const serviceTypeId = uuidv4();
    const serviceTypeName = `Service Type ${serviceTypeId.slice(0, 8)}`;
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
      service_name: 'Test Service',
      description: 'Test service description',
      default_rate: 1000,
      unit_of_measure: 'month',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    createdIds.serviceId = serviceId;

    const result = await createContractTemplateFromWizard({
      contract_name: 'USD Template Test',
      description: 'Template with USD currency',
      billing_frequency: 'monthly',
      currency_code: 'USD',
      fixed_services: [
        {
          service_id: serviceId,
          service_name: 'Test Service',
          quantity: 1
        }
      ],
      hourly_services: [],
      usage_services: [],
      fixed_base_rate: 1000,
      enable_proration: true
    });

    expect(result.contract_id).toBeDefined();
    createdIds.templateIds.push(result.contract_id);
    if (result.contract_line_ids) {
      createdIds.contractLineIds.push(...result.contract_line_ids);
    }

    // Verify template was saved with correct currency_code
    const template = await db('contract_templates')
      .where({ tenant: tenantId, template_id: result.contract_id })
      .first();

    expect(template).toBeTruthy();
    expect(template?.template_name).toBe('USD Template Test');
    expect(template?.currency_code).toBe('USD');
    expect(template?.default_billing_frequency).toBe('monthly');
    expect(template?.template_description).toBe('Template with USD currency');
  });

  it('creates a template with EUR currency and persists it correctly', async () => {
    const serviceTypeId = uuidv4();
    const serviceTypeName = `Service Type ${serviceTypeId.slice(0, 8)}`;
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
      service_name: 'Test Service EUR',
      description: 'Test service description',
      default_rate: 900,
      unit_of_measure: 'month',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    createdIds.serviceId = serviceId;

    const result = await createContractTemplateFromWizard({
      contract_name: 'EUR Template Test',
      description: 'Template with EUR currency',
      billing_frequency: 'monthly',
      currency_code: 'EUR',
      fixed_services: [
        {
          service_id: serviceId,
          service_name: 'Test Service EUR',
          quantity: 1
        }
      ],
      hourly_services: [],
      usage_services: [],
      fixed_base_rate: 900,
      enable_proration: false
    });

    expect(result.contract_id).toBeDefined();
    createdIds.templateIds.push(result.contract_id);
    if (result.contract_line_ids) {
      createdIds.contractLineIds.push(...result.contract_line_ids);
    }

    // Verify template was saved with correct currency_code
    const template = await db('contract_templates')
      .where({ tenant: tenantId, template_id: result.contract_id })
      .first();

    expect(template).toBeTruthy();
    expect(template?.template_name).toBe('EUR Template Test');
    expect(template?.currency_code).toBe('EUR');
    expect(template?.default_billing_frequency).toBe('monthly');
  });

  it('creates a template with GBP currency and persists it correctly', async () => {
    const serviceTypeId = uuidv4();
    const serviceTypeName = `Service Type ${serviceTypeId.slice(0, 8)}`;
    await db('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: serviceTypeName,
      billing_method: 'hourly',
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = uuidv4();
    await db('service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: 'Hourly Service GBP',
      description: 'Hourly billing service',
      default_rate: 75,
      unit_of_measure: 'hour',
      billing_method: 'hourly',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    createdIds.serviceId = serviceId;

    const result = await createContractTemplateFromWizard({
      contract_name: 'GBP Hourly Template',
      description: 'Template with GBP currency for hourly services',
      billing_frequency: 'monthly',
      currency_code: 'GBP',
      fixed_services: [],
      hourly_services: [
        {
          service_id: serviceId,
          service_name: 'Hourly Service GBP',
          hourly_rate: 75
        }
      ],
      usage_services: [],
      minimum_billable_time: 15,
      enable_proration: true
    });

    expect(result.contract_id).toBeDefined();
    createdIds.templateIds.push(result.contract_id);
    if (result.contract_line_ids) {
      createdIds.contractLineIds.push(...result.contract_line_ids);
    }

    // Verify template was saved with correct currency_code
    const template = await db('contract_templates')
      .where({ tenant: tenantId, template_id: result.contract_id })
      .first();

    expect(template).toBeTruthy();
    expect(template?.template_name).toBe('GBP Hourly Template');
    expect(template?.currency_code).toBe('GBP');
    expect(template?.default_billing_frequency).toBe('monthly');
  });

  it('creates templates with multiple currencies in same tenant', async () => {
    const serviceTypeId = uuidv4();
    const serviceTypeName = `Service Type ${serviceTypeId.slice(0, 8)}`;
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
      service_name: 'Multi Currency Service',
      description: 'Service for multiple currencies',
      default_rate: 1000,
      unit_of_measure: 'month',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    createdIds.serviceId = serviceId;

    // Create USD template
    const usdResult = await createContractTemplateFromWizard({
      contract_name: 'USD Multi Template',
      description: 'USD template',
      billing_frequency: 'monthly',
      currency_code: 'USD',
      fixed_services: [{ service_id: serviceId }],
      hourly_services: [],
      usage_services: [],
      fixed_base_rate: 1000,
      enable_proration: true
    });
    createdIds.templateIds.push(usdResult.contract_id);
    if (usdResult.contract_line_ids) {
      createdIds.contractLineIds.push(...usdResult.contract_line_ids);
    }

    // Create JPY template
    const jpyResult = await createContractTemplateFromWizard({
      contract_name: 'JPY Multi Template',
      description: 'JPY template',
      billing_frequency: 'monthly',
      currency_code: 'JPY',
      fixed_services: [{ service_id: serviceId }],
      hourly_services: [],
      usage_services: [],
      fixed_base_rate: 100000,
      enable_proration: true
    });
    createdIds.templateIds.push(jpyResult.contract_id);
    if (jpyResult.contract_line_ids) {
      createdIds.contractLineIds.push(...jpyResult.contract_line_ids);
    }

    // Verify both templates exist with correct currencies
    const usdTemplate = await db('contract_templates')
      .where({ tenant: tenantId, template_id: usdResult.contract_id })
      .first();
    expect(usdTemplate?.currency_code).toBe('USD');

    const jpyTemplate = await db('contract_templates')
      .where({ tenant: tenantId, template_id: jpyResult.contract_id })
      .first();
    expect(jpyTemplate?.currency_code).toBe('JPY');

    // Verify both templates are persisted separately
    const allTemplates = await db('contract_templates')
      .where({ tenant: tenantId })
      .whereIn('template_id', [usdResult.contract_id, jpyResult.contract_id])
      .select('template_id', 'currency_code', 'template_name');

    expect(allTemplates).toHaveLength(2);
    const usdEntry = allTemplates.find(t => t.template_id === usdResult.contract_id);
    const jpyEntry = allTemplates.find(t => t.template_id === jpyResult.contract_id);

    expect(usdEntry?.currency_code).toBe('USD');
    expect(jpyEntry?.currency_code).toBe('JPY');
  });

  it('creates draft template with currency and verifies status and currency', async () => {
    const serviceTypeId = uuidv4();
    const serviceTypeName = `Service Type ${serviceTypeId.slice(0, 8)}`;
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
      service_name: 'Draft Service',
      description: 'Service for draft template',
      default_rate: 500,
      unit_of_measure: 'month',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    createdIds.serviceId = serviceId;

    const result = await createContractTemplateFromWizard(
      {
        contract_name: 'Draft CAD Template',
        description: 'Draft template with CAD currency',
        billing_frequency: 'quarterly',
        currency_code: 'CAD',
        fixed_services: [{ service_id: serviceId }],
        hourly_services: [],
        usage_services: [],
        fixed_base_rate: 500,
        enable_proration: false
      },
      { isDraft: true }
    );

    expect(result.contract_id).toBeDefined();
    createdIds.templateIds.push(result.contract_id);
    if (result.contract_line_ids) {
      createdIds.contractLineIds.push(...result.contract_line_ids);
    }

    // Verify draft template was saved with correct currency_code and status
    const template = await db('contract_templates')
      .where({ tenant: tenantId, template_id: result.contract_id })
      .first();

    expect(template).toBeTruthy();
    expect(template?.template_status).toBe('draft');
    expect(template?.currency_code).toBe('CAD');
    expect(template?.default_billing_frequency).toBe('quarterly');
  });

  it('creates contract from template and inherits template currency (EUR)', async () => {
    // First, create a template with EUR currency
    const serviceTypeId = uuidv4();
    const serviceTypeName = `Service Type ${serviceTypeId.slice(0, 8)}`;
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
      service_name: 'EUR Inherited Service',
      description: 'Service for EUR template inheritance',
      default_rate: 500,
      unit_of_measure: 'month',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    createdIds.serviceId = serviceId;

    // Create a template with EUR currency
    const templateResult = await createContractTemplateFromWizard({
      contract_name: 'EUR Inheritance Template',
      description: 'Template for currency inheritance test',
      billing_frequency: 'monthly',
      currency_code: 'EUR',
      fixed_services: [{ service_id: serviceId }],
      hourly_services: [],
      usage_services: [],
      fixed_base_rate: 500,
      enable_proration: true
    });
    createdIds.templateIds.push(templateResult.contract_id);
    if (templateResult.contract_line_ids) {
      createdIds.contractLineIds.push(...templateResult.contract_line_ids);
    }

    // Verify template was created with EUR
    const template = await db('contract_templates')
      .where({ tenant: tenantId, template_id: templateResult.contract_id })
      .first();
    expect(template?.currency_code).toBe('EUR');

    // Create a client to associate the contract with
    const clientId = uuidv4();
    await db('clients').insert({
      client_id: clientId,
      tenant: tenantId,
      client_name: 'Test Client for EUR Contract',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.clientId = clientId;

    // Now create a contract using the template's currency (EUR)
    const contractResult = await createClientContractFromWizard({
      contract_name: 'Contract From EUR Template',
      description: 'Contract inheriting EUR from template',
      client_id: clientId,
      start_date: new Date().toISOString().split('T')[0],
      billing_frequency: 'monthly',
      currency_code: 'EUR', // Using the template's currency
      fixed_services: [{ service_id: serviceId, quantity: 1 }],
      hourly_services: [],
      usage_services: [],
      fixed_base_rate: 500,
      enable_proration: true
    });
    createdIds.contractIds.push(contractResult.contract_id);
    if (contractResult.contract_line_ids) {
      createdIds.contractLineIds.push(...contractResult.contract_line_ids);
    }

    // Verify contract was created with EUR currency
    const contract = await db('contracts')
      .where({ tenant: tenantId, contract_id: contractResult.contract_id })
      .first();

    expect(contract).toBeTruthy();
    expect(contract?.currency_code).toBe('EUR');
    expect(contract?.contract_name).toBe('Contract From EUR Template');
  });

  it('creates contract with JPY currency from template and preserves currency', async () => {
    const serviceTypeId = uuidv4();
    await db('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: `JPY Service Type ${serviceTypeId.slice(0, 8)}`,
      billing_method: 'hourly',
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.serviceTypeId = serviceTypeId;

    const serviceId = uuidv4();
    await db('service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: 'JPY Hourly Service',
      description: 'Hourly service for JPY test',
      default_rate: 10000,
      unit_of_measure: 'hour',
      billing_method: 'hourly',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null
    });
    createdIds.serviceId = serviceId;

    // Create template with JPY
    const templateResult = await createContractTemplateFromWizard({
      contract_name: 'JPY Hourly Template',
      description: 'JPY hourly template',
      billing_frequency: 'monthly',
      currency_code: 'JPY',
      fixed_services: [],
      hourly_services: [{ service_id: serviceId, hourly_rate: 10000 }],
      usage_services: [],
      minimum_billable_time: 30,
      enable_proration: false
    });
    createdIds.templateIds.push(templateResult.contract_id);
    if (templateResult.contract_line_ids) {
      createdIds.contractLineIds.push(...templateResult.contract_line_ids);
    }

    // Create client
    const clientId = uuidv4();
    await db('clients').insert({
      client_id: clientId,
      tenant: tenantId,
      client_name: 'JPY Contract Client',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.clientId = clientId;

    // Create contract with JPY
    const contractResult = await createClientContractFromWizard({
      contract_name: 'JPY Hourly Contract',
      description: 'Contract with JPY currency',
      client_id: clientId,
      start_date: new Date().toISOString().split('T')[0],
      billing_frequency: 'monthly',
      currency_code: 'JPY',
      fixed_services: [],
      hourly_services: [{ service_id: serviceId, hourly_rate: 10000 }],
      usage_services: [],
      minimum_billable_time: 30,
      enable_proration: false
    });
    createdIds.contractIds.push(contractResult.contract_id);
    if (contractResult.contract_line_ids) {
      createdIds.contractLineIds.push(...contractResult.contract_line_ids);
    }

    // Verify both template and contract have JPY
    const template = await db('contract_templates')
      .where({ tenant: tenantId, template_id: templateResult.contract_id })
      .first();
    expect(template?.currency_code).toBe('JPY');

    const contract = await db('contracts')
      .where({ tenant: tenantId, contract_id: contractResult.contract_id })
      .first();
    expect(contract?.currency_code).toBe('JPY');
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
    client_name: 'Template Currency Integration Test Tenant',
    email: 'template-currency-test@test.co',
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

  // Delete contract_line related records first (deepest dependencies)
  await safeDeleteIn('contract_line_service_bucket_config', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_usage_config', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_rate_tiers', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_hourly_configs', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_hourly_config', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_fixed_config', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_configuration', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_services', 'contract_line_id', ids.contractLineIds);

  // Delete contract_template_lines (links templates to lines)
  for (const templateId of ids.templateIds) {
    await safeDelete('contract_template_lines', {
      tenant: tenantId,
      template_id: templateId
    });
  }

  // Delete contract_lines
  await safeDeleteIn('contract_lines', 'contract_line_id', ids.contractLineIds);

  // Delete contract_templates
  for (const templateId of ids.templateIds) {
    await safeDelete('contract_templates', {
      tenant: tenantId,
      template_id: templateId
    });
  }

  // Delete client_contract_lines and client_contracts
  for (const contractId of ids.contractIds) {
    await safeDelete('client_contract_lines', {
      tenant: tenantId,
      contract_id: contractId
    });
    await safeDelete('contracts', {
      tenant: tenantId,
      contract_id: contractId
    });
  }

  // Clean up clients
  if (ids.clientId) {
    await safeDelete('clients', {
      tenant: tenantId,
      client_id: ids.clientId
    });
  }

  // Clean up service catalog
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

  // Clean up service types
  if (ids.serviceTypeId) {
    await safeDelete('service_types', {
      tenant: tenantId,
      id: ids.serviceTypeId
    });
  }
}
