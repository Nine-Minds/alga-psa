import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureClientPlanBundlesTable
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { updateContract } from '@alga-psa/billing/actions';

// Override DB_PORT to connect directly to PostgreSQL instead of pgbouncer
process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/core', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Multi-Currency Billing', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
    await ensureClientPlanBundlesTable(context);
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'contracts',
        'clients',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
      ],
      clientName: 'Multi-Currency Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureDefaultTax();
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    // Set up invoice numbering settings
    const nextNumberRecord = {
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    };
    await context.db('next_number').insert(nextNumberRecord);

    await configureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should generate an invoice in EUR when contract is EUR', async () => {
    // 1. Update client default currency to EUR
    await context.db('clients')
      .where({ client_id: context.clientId })
      .update({ default_currency_code: 'EUR' });

    // 2. Create a service
    const serviceId = await createTestService(context, {
      service_name: 'EUR Service',
      billing_method: 'fixed',
      default_rate: 10000, // 100.00 EUR
      tax_region: 'US-NY'
    });

    // 3. Create a contract with EUR currency
    const contractId = uuidv4();
    await context.db('contracts').insert({
      contract_id: contractId,
      contract_name: 'EUR Contract',
      billing_frequency: 'monthly',
      currency_code: 'EUR',
      status: 'active',
      tenant: context.tenantId,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // 4. Create a contract line linked to this contract
    const contractLineId = uuidv4();
    await context.db('contract_lines').insert({
      contract_line_id: contractLineId,
      contract_id: contractId,
      contract_line_name: 'EUR Line',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      is_custom: false,
      tenant: context.tenantId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // 5. Assign the contract line to the client
    const clientContractLineId = uuidv4();
    await context.db('client_contract_lines').insert({
      client_contract_line_id: clientContractLineId,
      client_id: context.clientId,
      contract_line_id: contractLineId,
      start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      is_active: true,
      tenant: context.tenantId
    });

    // 6. Add service configuration to the contract line (Fixed)
    const configId = uuidv4();
    await context.db('contract_line_service_configuration').insert({
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      custom_rate: 10000, // 100.00
      quantity: 1,
      tenant: context.tenantId
    });

    // 7. Create billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    // Act
    const result = await generateInvoice(billingCycleId);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.currencyCode).toBe('EUR');
    expect(result?.total_amount).toBeGreaterThan(0); // Should be 10000 + tax
    
    // Check database persistence
    const savedInvoice = await context.db('invoices')
      .where({ invoice_id: result?.invoice_id })
      .first();
    expect(savedInvoice.currency_code).toBe('EUR');
  });

  it('should throw error when mixed currencies are detected', async () => {
    // 1. Create Contract A (USD)
    const contractAId = uuidv4();
    await context.db('contracts').insert({
      contract_id: contractAId,
      contract_name: 'USD Contract',
      billing_frequency: 'monthly',
      currency_code: 'USD',
      status: 'active',
      tenant: context.tenantId,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // 2. Create Contract B (EUR)
    const contractBId = uuidv4();
    await context.db('contracts').insert({
      contract_id: contractBId,
      contract_name: 'EUR Contract',
      billing_frequency: 'monthly',
      currency_code: 'EUR',
      status: 'active',
      tenant: context.tenantId,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // 3. Create lines for both
    const lineAId = uuidv4();
    await context.db('contract_lines').insert({
      contract_line_id: lineAId,
      contract_id: contractAId,
      contract_line_name: 'USD Line',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      is_custom: false,
      tenant: context.tenantId
    });

    const lineBId = uuidv4();
    await context.db('contract_lines').insert({
      contract_line_id: lineBId,
      contract_id: contractBId,
      contract_line_name: 'EUR Line',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      is_custom: false,
      tenant: context.tenantId
    });

    // 4. Assign both to client
    await context.db('client_contract_lines').insert([
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: lineAId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      },
      {
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: lineBId,
        start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        is_active: true,
        tenant: context.tenantId
      }
    ]);

    // 5. Add dummy service configs so they are billed
    const serviceId = await createTestService(context, { service_name: 'Generic Service' });
    await context.db('contract_line_service_configuration').insert([
      {
        config_id: uuidv4(),
        contract_line_id: lineAId,
        service_id: serviceId,
        configuration_type: 'Fixed',
        custom_rate: 100,
        tenant: context.tenantId
      },
      {
        config_id: uuidv4(),
        contract_line_id: lineBId,
        service_id: serviceId,
        configuration_type: 'Fixed',
        custom_rate: 100,
        tenant: context.tenantId
      }
    ]);

    // 6. Create billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    // Act & Assert
    await expect(generateInvoice(billingCycleId))
      .rejects
      .toThrow(/Mixed currency billing is not supported/);
  });

  it('should default to client currency if contract currency is missing (simulating legacy)', async () => {
    // 1. Update client default currency to GBP
    await context.db('clients')
      .where({ client_id: context.clientId })
      .update({ default_currency_code: 'GBP' });

    // 2. Create a contract with NO currency (simulating legacy or null)
    const contractId = uuidv4();
    await context.db('contracts').insert({
      contract_id: contractId,
      contract_name: 'Legacy Contract',
      billing_frequency: 'monthly',
      currency_code: null, // Explicitly null
      status: 'active',
      tenant: context.tenantId,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // 3. Setup line and assignment
    const lineId = uuidv4();
    await context.db('contract_lines').insert({
      contract_line_id: lineId,
      contract_id: contractId,
      contract_line_name: 'Legacy Line',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      is_custom: false,
      tenant: context.tenantId
    });

    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: lineId,
      start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      is_active: true,
      tenant: context.tenantId
    });

    const serviceId = await createTestService(context, { service_name: 'GBP Service' });
    await context.db('contract_line_service_configuration').insert({
      config_id: uuidv4(),
      contract_line_id: lineId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      custom_rate: 5000, // 50.00 GBP
      tenant: context.tenantId
    });

    // 4. Create billing cycle
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    // Act
    const result = await generateInvoice(billingCycleId);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.currencyCode).toBe('GBP'); // Should fallback to client default
    
    const savedInvoice = await context.db('invoices')
      .where({ invoice_id: result?.invoice_id })
      .first();
    expect(savedInvoice.currency_code).toBe('GBP');
  });
});
