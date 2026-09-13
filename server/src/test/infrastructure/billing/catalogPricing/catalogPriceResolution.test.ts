import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  materializeRecurringServicePeriods,
  setLineProvenance,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/core/secrets', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowEventModel: { create: vi.fn() },
}));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({ publishEvent: vi.fn() }),
  toStreamEvent: (event: unknown) => event,
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Catalog price resolution – fixed path', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 0
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  async function linkMemberToCatalog(contractLineId: string): Promise<void> {
    await context.db.raw(
      `UPDATE contract_line_service_fixed_config AS clsfc
       SET base_rate = NULL, rate_provenance = 'inherited'
       FROM contract_line_service_configuration AS clsc
       WHERE clsc.config_id = clsfc.config_id
         AND clsc.tenant = clsfc.tenant
         AND clsc.tenant = ?
         AND clsc.contract_line_id = ?`,
      [context.tenantId, contractLineId],
    );
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'contract_line_service_configuration',
        'contract_line_service_fixed_config',
        'service_prices',
        'service_catalog',
        'contract_lines',
        'contracts',
        'client_contracts',
        'contract_pricing_schedules',
        'bucket_plans',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
      ],
      clientName: 'Catalog Price Billing Client',
      userType: 'internal'
    });

    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    await configureDefaultTax();
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    });

    await configureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('T20: fixed path bills the effective service_prices rate in the contract currency, not default_rate', async () => {
    // seedServicePrice:false keeps the legacy default_rate and the currency
    // price from being seeded from one value, so the divergence is real.
    const serviceId = await createTestService(context, {
      service_name: 'Multi currency endpoint',
      billing_method: 'fixed',
      default_rate: 10000,
      seedServicePrice: false
    });

    const { contractLineId, contractId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Euro Catalog Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      quantity: 1,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      billingTiming: 'advance'
    });

    // Contract prices in EUR; the catalog has a EUR row at 12000 and the legacy
    // default_rate stays 10000.
    await context.db('contracts')
      .where({ tenant: context.tenantId, contract_id: contractId })
      .update({ currency_code: 'EUR' });
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ default_currency_code: 'EUR' });
    await context.db('service_prices').insert({
      tenant: context.tenantId,
      service_id: serviceId,
      currency_code: 'EUR',
      rate: 12000,
      effective_date: '1970-01-01'
    });

    await linkMemberToCatalog(contractLineId);
    await setLineProvenance(context, contractLineId, 'inherited');
    await materializeRecurringServicePeriods(context, contractLineId);

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    const result = await generateInvoice(billingCycleId);

    expect(result).not.toBeNull();
    expect(result!.subtotal).toBe(12000);

    const invoiceItems = await context.db('invoice_charges')
      .where('invoice_id', result!.invoice_id)
      .select('*');
    expect(invoiceItems).toHaveLength(1);
    expect(parseInt(invoiceItems[0].net_amount)).toBe(12000);
  });
});
