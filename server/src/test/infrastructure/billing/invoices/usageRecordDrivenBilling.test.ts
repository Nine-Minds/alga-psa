import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { generateInvoice, previewInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import { getContractMonthlyValuesByAssignment } from '@alga-psa/shared/billingClients/contractMonthlyValue';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  assignContractLineToClient,
  createTestService,
  ensureClientPlanBundlesTable
} from '../../../../../test-utils/billingTestHelpers';

// Force connection directly to PostgreSQL (not pgbouncer on 6432)
process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

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
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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
  WorkflowEventModel: {
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({
    publishEvent: vi.fn(),
  }),
  toStreamEvent: (event: unknown) => event,
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: mockedUserId,
    tenant: mockedTenantId,
    user_type: 'internal',
    roles: []
  }))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

/**
 * Behavioral coverage of record-driven usage billing (Model A):
 * - only explicit period-dated usage_tracking records create charges;
 * - a configured (legacy) quantity is inert non-billing metadata;
 * - a missing record surfaces as the coded USAGE_RECORDS_MISSING preview state
 *   rather than a silent "Nothing to bill";
 * - minimum_usage is a floor applied only when a record exists;
 * - already-invoiced records never bill twice;
 * - recurring-revenue reporting flags variable usage instead of encoding it as zero.
 */
describe('Usage contracts – record-driven billing semantics', () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext
  } = TestContext.createHelpers();

  let context: TestContext;

  async function ensureDefaultTaxConfiguration() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State + City Tax',
      startDate: '2023-01-01T00:00:00.000Z',
      taxPercentage: 10
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
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
        'service_catalog',
        'contract_lines',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
      ],
      clientName: 'Usage Semantics Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await ensureDefaultTaxConfiguration();
    await ensureClientPlanBundlesTable(context);
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

    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    });

    await ensureDefaultTaxConfiguration();
    await ensureClientPlanBundlesTable(context);
  }, 60000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  /**
   * Builds a monthly usage contract line whose service period Jan 2023 is
   * invoiced in the Feb 1 – Mar 1 window (usage lines default to arrears).
   * `legacyQuantity` mimics production rows where the configuration still
   * carries a seat count: it must never bill.
   */
  async function setupUsageAssignment(options: {
    legacyQuantity?: number;
    minimumUsage?: number;
    serviceName?: string;
  } = {}) {
    const serviceId = await createTestService(context, {
      service_name: options.serviceName ?? 'Managed Seats',
      billing_method: 'usage',
      default_rate: 1000, // $10.00 per seat
      unit_of_measure: 'seat',
      tax_region: 'US-NY'
    });

    const contractLineId = await context.createEntity('contract_lines', {
      contract_line_name: 'Usage Contract Line',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Usage'
    }, 'contract_line_id');

    const configId = uuidv4();
    await context.db('contract_line_service_configuration').insert({
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Usage',
      quantity: options.legacyQuantity ?? null,
      tenant: context.tenantId
    });

    if (options.minimumUsage !== undefined) {
      await context.db('contract_line_service_usage_config').insert({
        config_id: configId,
        tenant: context.tenantId,
        unit_of_measure: 'seat',
        enable_tiered_pricing: false,
        minimum_usage: options.minimumUsage,
        base_rate: 1000
      });
    }

    await context.db('contract_line_services').insert({
      contract_line_id: contractLineId,
      service_id: serviceId,
      tenant: context.tenantId
    });

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 })
    }, 'billing_cycle_id');

    const assignment = await assignContractLineToClient(context, contractLineId, {
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    return { serviceId, contractLineId, billingCycleId, ...assignment };
  }

  async function insertUsageRecord(serviceId: string, quantity: string, usageDate = '2023-01-15') {
    const usageId = uuidv4();
    await context.db('usage_tracking').insert({
      tenant: context.tenantId,
      usage_id: usageId,
      client_id: context.clientId,
      service_id: serviceId,
      usage_date: usageDate,
      quantity
    });
    return usageId;
  }

  it('reports missing usage instead of billing a configured legacy quantity', async () => {
    const { serviceId, billingCycleId } = await setupUsageAssignment({ legacyQuantity: 10 });

    const preview = await previewInvoice(billingCycleId);

    expect(preview.success).toBe(false);
    if (preview.success) throw new Error('unreachable');
    expect(preview.code).toBe('USAGE_RECORDS_MISSING');
    expect(preview.params?.services).toContain('Managed Seats');
    // The failure names the applicable service period (January 2023; the
    // engine reports the period's last covered day as the end).
    expect(preview.params?.periodStart).toBe('2023-01-01');
    expect(preview.params?.periodEnd).toBe('2023-01-31');

    // The legacy quantity must not have produced any charge anywhere.
    const invoices = await context.db('invoices').where({ tenant: context.tenantId });
    expect(invoices).toHaveLength(0);
    const records = await context.db('usage_tracking')
      .where({ tenant: context.tenantId, service_id: serviceId });
    expect(records).toHaveLength(0);
  });

  it('bills the recorded usage quantity, not the configured legacy quantity', async () => {
    const { serviceId, billingCycleId } = await setupUsageAssignment({ legacyQuantity: 10 });
    await insertUsageRecord(serviceId, '4');

    const result = await generateInvoice(billingCycleId);
    expect(result).not.toBeNull();

    // 4 recorded seats × $10.00, never 10 configured seats.
    expect(result).toMatchObject({
      subtotal: 4000,
      tax: 400,
      total_amount: 4400,
      status: 'draft'
    });
  });

  it('does not create a minimum charge for a period with no usage record', async () => {
    const { billingCycleId } = await setupUsageAssignment({ minimumUsage: 5 });

    const preview = await previewInvoice(billingCycleId);

    expect(preview.success).toBe(false);
    if (preview.success) throw new Error('unreachable');
    expect(preview.code).toBe('USAGE_RECORDS_MISSING');

    const invoices = await context.db('invoices').where({ tenant: context.tenantId });
    expect(invoices).toHaveLength(0);
  });

  it('floors an explicit zero-usage record to the configured minimum', async () => {
    const { serviceId, billingCycleId } = await setupUsageAssignment({ minimumUsage: 5 });
    await insertUsageRecord(serviceId, '0');

    const result = await generateInvoice(billingCycleId);
    expect(result).not.toBeNull();

    // Explicit zero record exists → floor applies: 5 × $10.00.
    expect(result).toMatchObject({
      subtotal: 5000,
      tax: 500,
      total_amount: 5500,
      status: 'draft'
    });
  });

  it('previews an explicit zero-usage record as a valid zero, not missing usage', async () => {
    const { serviceId, billingCycleId } = await setupUsageAssignment();
    await insertUsageRecord(serviceId, '0');

    const preview = await previewInvoice(billingCycleId);

    // A recorded zero is a real (zero-total) charge: preview succeeds and the
    // window is not reported as missing usage.
    expect(preview.success).toBe(true);
    if (!preview.success) throw new Error('unreachable');
    expect(preview.data.total).toBe(0);
    expect(preview.usageServicePeriodStatuses ?? []).toHaveLength(0);
  });

  it('bills only the applicable period and never re-bills invoiced records', async () => {
    const { serviceId, billingCycleId } = await setupUsageAssignment();
    const januaryUsageId = await insertUsageRecord(serviceId, '8', '2023-01-10');
    const februaryUsageId = await insertUsageRecord(serviceId, '3', '2023-02-10');

    const first = await generateInvoice(billingCycleId);
    expect(first).not.toBeNull();
    expect(first).toMatchObject({ subtotal: 8000 });

    // Only January's record is marked invoiced; February's stays available
    // for its own period.
    const january = await context.db('usage_tracking')
      .where({ tenant: context.tenantId, usage_id: januaryUsageId })
      .first();
    const february = await context.db('usage_tracking')
      .where({ tenant: context.tenantId, usage_id: februaryUsageId })
      .first();
    expect(january?.invoiced).toBe(true);
    expect(february?.invoiced).toBe(false);

    // Re-running the same cycle must not double-bill the invoiced record —
    // whether the guard surfaces as a thrown error or an action-error envelope.
    const second = await generateInvoice(billingCycleId).catch((error) => error);
    expect(second === null || second instanceof Error || 'actionError' in (second ?? {})).toBe(true);

    const chargeRows = await context.db('invoice_charges')
      .where({ tenant: context.tenantId })
      .select('*');
    const usageChargeRows = chargeRows.filter((row) =>
      String(row.description ?? '').includes('Managed Seats'));
    expect(usageChargeRows).toHaveLength(1);
  });

  it('reports usage contracts as variable revenue, never zero contractual MRR', async () => {
    const { clientContractId, contractId } = await setupUsageAssignment();

    // Add a fixed line on the same contract so the fixed portion is non-zero.
    const fixedLineId = await context.createEntity('contract_lines', {
      contract_line_name: 'Fixed Line',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed',
      custom_rate: 20000,
      contract_id: contractId
    }, 'contract_line_id');
    await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: fixedLineId })
      .update({ contract_id: contractId });

    const values = await getContractMonthlyValuesByAssignment(
      context.db,
      context.tenantId,
      [clientContractId]
    );

    const value = values.get(clientContractId);
    expect(value).toBeDefined();
    // Fixed recurring value counts; the usage line is flagged as variable
    // instead of being silently encoded as zero.
    expect(value?.monthlyValueCents).toBe(20000);
    expect(value?.hasVariableUsage).toBe(true);
  });
});
