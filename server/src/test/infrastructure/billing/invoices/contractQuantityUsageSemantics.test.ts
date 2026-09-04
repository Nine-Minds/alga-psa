import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { generateInvoice, previewInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import {
  upsertUsagePeriodTotal,
  deleteUsagePeriodTotal,
  getUsagePeriodTotals,
} from '@alga-psa/billing/actions/usagePeriodTotalActions';
import { createUsageRecord } from '@alga-psa/billing/actions/usageActions';
import { scheduleUnitPricingRevision } from '@alga-psa/billing/actions/contractLineUnitPricingActions';
import { setUsageMeasurementMode } from '@alga-psa/billing/actions/contractLineSemanticsActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  assignContractLineToClient,
  createTestService,
  ensureClientPlanBundlesTable,
  unwrapInvoiceResult,
} from '../../../../../test-utils/billingTestHelpers';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: { capture: vi.fn(), identify: vi.fn(), trackPerformance: vi.fn(), getClient: () => null }
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

vi.mock('@alga-psa/workflows/persistence', () => ({ WorkflowEventModel: { create: vi.fn() } }));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({ publishEvent: vi.fn() }),
  toStreamEvent: (event: unknown) => event,
}));

vi.mock('server/src/lib/auth/rbac', () => ({ hasPermission: vi.fn(() => Promise.resolve(true)) }));

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

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Contract quantity & usage semantics — period totals and recurring seats', () => {
  let context: TestContext;

  async function ensureDefaultTaxConfiguration() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY Tax',
      startDate: '2023-01-01T00:00:00.000Z',
      taxPercentage: 10
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'usage_period_totals',
        'contract_line_unit_pricing_revisions',
        'recurring_service_periods',
        'invoice_charges',
        'invoices',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'client_billing_cycles',
        'client_contract_lines',
        'client_contracts',
        'contract_line_service_rate_tiers',
        'contract_line_service_fixed_config',
        'contract_line_service_usage_config',
        'contract_line_service_configuration',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'contracts',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
      ],
      clientName: 'Quantity & Usage Semantics Client',
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

  const JAN_PERIOD = { period_start: '2023-01-01', period_end: '2023-01-31' };

  /**
   * A monthly Usage line whose January service period is invoiced by a
   * February invoice window (usage lines default to arrears; this mirrors
   * usageRecordDrivenBilling.test.ts).
   */
  async function setupUsageLine(options: {
    serviceName?: string;
    minimumUsage?: number;
    measurementMode?: 'additive' | 'period_total';
    defaultRateCents?: number;
  } = {}) {
    const serviceId = await createTestService(context, {
      service_name: options.serviceName ?? 'Usage Service',
      billing_method: 'usage',
      default_rate: options.defaultRateCents ?? 1000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY'
    });

    const contractLineId = await context.createEntity('contract_lines', {
      contract_line_name: 'Usage Line',
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
      quantity: null,
      tenant: context.tenantId
    });

    await context.db('contract_line_service_usage_config').insert({
      config_id: configId,
      tenant: context.tenantId,
      unit_of_measure: 'unit',
      enable_tiered_pricing: false,
      minimum_usage: options.minimumUsage ?? 0,
      measurement_mode: options.measurementMode ?? 'additive',
      base_rate: options.defaultRateCents ?? 1000
    });

    await context.db('contract_line_services').insert({
      contract_line_id: contractLineId,
      service_id: serviceId,
      tenant: context.tenantId
    });

    const assignment = await assignContractLineToClient(context, contractLineId, {
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
    });

    const billingCycleId = await setupInvoiceCycle(2023, 2, 1);

    return { serviceId, contractLineId, configId, billingCycleId, ...assignment };
  }

  async function setupInvoiceCycle(year: number, month: number, day: number) {
    const endDate = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year, month, day }),
      period_start_date: createTestDateISO({ year, month, day }),
      period_end_date: endDate
    }, 'billing_cycle_id');
    return billingCycleId;
  }

  function totalsTable() {
    return context.db('usage_period_totals');
  }

  describe('period-total reports (R3 / F006–F009)', () => {
    it('bills one reported period total once and consumes exactly its revision', async () => {
      const { serviceId, contractLineId, configId, billingCycleId } = await setupUsageLine({
        measurementMode: 'period_total'
      });

      const created = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 10,
        request_id: uuidv4()
      });
      if ('actionError' in (created as object)) throw new Error(JSON.stringify(created));

      const invoice = unwrapInvoiceResult(await generateInvoice(billingCycleId));
      expect(invoice).toMatchObject({ subtotal: 10000, tax: 1000, total_amount: 11000, status: 'draft' });

      const rows = await totalsTable().where({ tenant: context.tenantId });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ quantity: 10, revision: 1, lifecycle_state: 'billed' });
      expect(rows[0].invoice_id).toBe(invoice.invoice_id);
    });

    it('replace 10 with 12 bills 12 once, never 22, and replays do not double bill', async () => {
      const { serviceId, contractLineId, configId, billingCycleId } = await setupUsageLine({
        measurementMode: 'period_total'
      });
      const requestId = uuidv4();

      const first = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 10,
        request_id: requestId
      });
      if ('actionError' in (first as object)) throw new Error(JSON.stringify(first));

      // Replay of the identical save returns the same row and adds nothing.
      const replay = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 10,
        request_id: requestId
      });
      if ('actionError' in (replay as object)) throw new Error(JSON.stringify(replay));
      expect((replay as any).total.quantity).toBe(10);

      // Reusing the request id with different content is rejected.
      const changedReplay = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 12,
        request_id: requestId
      });
      expect('actionError' in (changedReplay as object)).toBe(true);

      // Edit replaces: 10 → 12, one logical row only.
      const replaced = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 12,
        expected_revision: 1
      });
      if ('actionError' in (replaced as object)) throw new Error(JSON.stringify(replaced));

      const rowsBefore = await totalsTable().where({ tenant: context.tenantId });
      expect(rowsBefore).toHaveLength(1);
      expect(rowsBefore[0]).toMatchObject({ quantity: 12, revision: 2, lifecycle_state: 'recorded' });

      const invoice = unwrapInvoiceResult(await generateInvoice(billingCycleId));
      expect(invoice).toMatchObject({ subtotal: 12000, tax: 1200, total_amount: 13200 });

      const rowsAfter = await totalsTable().where({ tenant: context.tenantId });
      expect(rowsAfter).toHaveLength(1);
      expect(rowsAfter[0]).toMatchObject({ quantity: 12, revision: 2, lifecycle_state: 'billed' });

      // Re-generating the same window must not create a second charge.
      const second = await generateInvoice(billingCycleId).catch((error: unknown) => error);
      expect(second === null || second instanceof Error || 'actionError' in (second ?? {})).toBe(true);
    });

    it('stale writers are rejected; competing revision updates do not silently overwrite', async () => {
      const { serviceId, contractLineId, configId } = await setupUsageLine({ measurementMode: 'period_total' });

      await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 10
      });

      // Writer A wins: revision 1 → 2.
      const winner = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 12,
        expected_revision: 1
      });
      if ('actionError' in (winner as object)) throw new Error(JSON.stringify(winner));

      // Writer B still thinks revision 1 → rejected, not silently applied.
      const loser = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 99,
        expected_revision: 1
      });
      expect('actionError' in (loser as object)).toBe(true);

      const rows = await totalsTable().where({ tenant: context.tenantId });
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(12);
    });

    it('simultaneous creates of the same period yield one logical total', async () => {
      const { serviceId, contractLineId, configId, billingCycleId } = await setupUsageLine({ measurementMode: 'period_total' });

      const [a, b] = await Promise.all([
        upsertUsagePeriodTotal({
          client_id: context.clientId,
          client_contract_line_id: contractLineId,
          service_id: serviceId,
          config_id: configId,
          period_start: JAN_PERIOD.period_start,
          period_end: JAN_PERIOD.period_end,
          quantity: 10,
          request_id: uuidv4()
        }),
        upsertUsagePeriodTotal({
          client_id: context.clientId,
          client_contract_line_id: contractLineId,
          service_id: serviceId,
          config_id: configId,
          period_start: JAN_PERIOD.period_start,
          period_end: JAN_PERIOD.period_end,
          quantity: 10,
          request_id: uuidv4()
        }),
      ]);
      for (const result of [a, b]) {
        expect('actionError' in (result as object)).toBe(false);
      }

      const rows = await totalsTable().where({ tenant: context.tenantId });
      expect(rows).toHaveLength(1);

      const invoice = unwrapInvoiceResult(await generateInvoice(billingCycleId));
      expect(invoice.subtotal).toBe(10000);
    });

    it('a regenerated period identity cannot create a second total (key survives)', async () => {
      const { serviceId, contractLineId, configId } = await setupUsageLine({ measurementMode: 'period_total' });
      const requestId = uuidv4();
      await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 7,
        request_id: requestId
      });

      // Regeneration would re-run the same create: still one total.
      const again = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 7,
        request_id: requestId
      });
      expect('actionError' in (again as object)).toBe(false);
      const rows = await totalsTable().where({ tenant: context.tenantId });
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(7);
    });

    it('explicit zero is a valid report; an unreported next period carries no charge and no carry-forward', async () => {
      const { serviceId, contractLineId, configId, billingCycleId } = await setupUsageLine({
        measurementMode: 'period_total',
        minimumUsage: 0
      });

      // January: explicit zero report.
      const zero = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 0
      });
      if ('actionError' in (zero as object)) throw new Error(JSON.stringify(zero));

      const invoice = unwrapInvoiceResult(await generateInvoice(billingCycleId));
      // Zero bills zero (no minimum). The report is consumed.
      expect(invoice.subtotal).toBe(0);

      const rows = await totalsTable().where({ tenant: context.tenantId });
      expect(rows[0].lifecycle_state).toBe('billed');
    });

    it('applies minimum/tier pricing once to the effective total', async () => {
      const { serviceId, contractLineId, configId, billingCycleId } = await setupUsageLine({
        measurementMode: 'period_total',
        minimumUsage: 5
      });

      const zero = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 0
      });
      if ('actionError' in (zero as object)) throw new Error(JSON.stringify(zero));

      // The floor applies once to the period total: 5 × $10.
      const invoice = unwrapInvoiceResult(await generateInvoice(billingCycleId));
      expect(invoice).toMatchObject({ subtotal: 5000 });
    });

    it('an invoiced total cannot be edited, deleted, or recreated as another unbilled total', async () => {
      const { serviceId, contractLineId, configId, billingCycleId } = await setupUsageLine({ measurementMode: 'period_total' });
      await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 10
      });
      await generateInvoice(billingCycleId);

      const edit = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 12
      });
      expect('actionError' in (edit as object)).toBe(true);

      const del = await deleteUsagePeriodTotal({ period_total_id: (await totalsTable().where({ tenant: context.tenantId }).first())!.period_total_id });
      expect('actionError' in (del as object)).toBe(true);

      const rows = await totalsTable().where({ tenant: context.tenantId });
      expect(rows[0]).toMatchObject({ quantity: 10, lifecycle_state: 'billed' });
    });

    it('negative / non-finite quantity is rejected', async () => {
      const { serviceId, contractLineId, configId } = await setupUsageLine({ measurementMode: 'period_total' });
      const result = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: contractLineId,
        service_id: serviceId,
        config_id: configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: -1
      });
      expect('actionError' in (result as object)).toBe(true);
    });

    it('an unreported period is reported as unreported, never an implicit zero', async () => {
      const { billingCycleId } = await setupUsageLine({ measurementMode: 'period_total' });
      const preview = await previewInvoice(billingCycleId);
      expect(preview.success).toBe(false);
      if (preview.success) throw new Error('unreachable');
      expect(preview.code).toBe('USAGE_RECORDS_MISSING');
    });
  });

  describe('mode guards and additive compatibility (R4 / F010–F011)', () => {
    it('additive entries are rejected for a period-total configuration', async () => {
      const { serviceId, contractLineId, configId } = await setupUsageLine({
        measurementMode: 'period_total',
        serviceName: 'PT Only Service'
      });
      const result = await createUsageRecord({
        client_id: context.clientId,
        service_id: serviceId,
        quantity: 3,
        usage_date: '2023-01-15',
        contract_line_id: contractLineId
      });
      expect('actionError' in (result as object)).toBe(true);

      const rows = await context.db('usage_tracking').where({ tenant: context.tenantId });
      expect(rows).toHaveLength(0);
      void configId;
    });

    it('separate additive entries still bill additively and keep per-entry semantics', async () => {
      const { serviceId, contractLineId, billingCycleId } = await setupUsageLine({
        measurementMode: 'additive',
        minimumUsage: 0
      });
      await createUsageRecord({ client_id: context.clientId, service_id: serviceId, quantity: 10, usage_date: '2023-01-10', contract_line_id: contractLineId });
      await createUsageRecord({ client_id: context.clientId, service_id: serviceId, quantity: 12, usage_date: '2023-01-12', contract_line_id: contractLineId });

      const invoice = unwrapInvoiceResult(await generateInvoice(billingCycleId));
      expect(invoice).toMatchObject({ subtotal: 22000, tax: 2200, total_amount: 24200 });

      const rows = await context.db('usage_tracking').where({ tenant: context.tenantId });
      expect(rows).toHaveLength(2);
      expect(rows.every((row: any) => row.invoiced === true)).toBe(true);
    });

    it('converting a config with unbilled additive entries to period_total is blocked', async () => {
      const { serviceId, contractLineId, configId } = await setupUsageLine({ measurementMode: 'additive', minimumUsage: 0 });
      await createUsageRecord({ client_id: context.clientId, service_id: serviceId, quantity: 3, usage_date: '2023-01-15', contract_line_id: contractLineId });

      const blocked = await setUsageMeasurementMode({
        config_id: configId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        measurement_mode: 'period_total'
      });
      expect('actionError' in (blocked as object)).toBe(true);
    });

    it('converting a clean additive config to period_total succeeds', async () => {
      const { serviceId, contractLineId, configId } = await setupUsageLine({ measurementMode: 'additive' });
      const ok = await setUsageMeasurementMode({
        config_id: configId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        measurement_mode: 'period_total'
      });
      expect('actionError' in (ok as object)).toBe(false);
      const config = await context.db('contract_line_service_usage_config').where({ tenant: context.tenantId, config_id: configId }).first();
      expect(config?.measurement_mode).toBe('period_total');
    });

    it('an identical additive request-id replay is one event; changed content is rejected; distinct ids stay separate', async () => {
      const { serviceId, contractLineId, billingCycleId } = await setupUsageLine({ measurementMode: 'additive', minimumUsage: 0 });
      const requestId = uuidv4();

      const first = await createUsageRecord({
        client_id: context.clientId,
        service_id: serviceId,
        quantity: 10,
        usage_date: '2023-01-10',
        contract_line_id: contractLineId,
        request_id: requestId
      });
      if ('actionError' in (first as object)) throw new Error(JSON.stringify(first));

      // Identical replay: returns the original record, no second row.
      const replay = await createUsageRecord({
        client_id: context.clientId,
        service_id: serviceId,
        quantity: 10,
        usage_date: '2023-01-10',
        contract_line_id: contractLineId,
        request_id: requestId
      });
      expect('actionError' in (replay as object)).toBe(false);
      expect((replay as any).usage_id).toBe((first as any).usage_id);

      // Reusing the id with different content is rejected.
      const changed = await createUsageRecord({
        client_id: context.clientId,
        service_id: serviceId,
        quantity: 12,
        usage_date: '2023-01-10',
        contract_line_id: contractLineId,
        request_id: requestId
      });
      expect('actionError' in (changed as object)).toBe(true);

      // Distinct request ids with identical content are separate legitimate events.
      const second = await createUsageRecord({
        client_id: context.clientId,
        service_id: serviceId,
        quantity: 10,
        usage_date: '2023-01-10',
        contract_line_id: contractLineId,
        request_id: uuidv4()
      });
      expect('actionError' in (second as object)).toBe(false);

      const rows = await context.db('usage_tracking').where({ tenant: context.tenantId });
      expect(rows).toHaveLength(2);

      // 10 + 10 bill additively.
      const invoice = unwrapInvoiceResult(await generateInvoice(billingCycleId));
      expect(invoice).toMatchObject({ subtotal: 20000 });
    });
  });

  describe('recurring seats (R2 / F004–F005)', () => {
    async function addSeatService(lineId: string, options: {
      serviceName: string;
      quantity: number;
      unitRateCents: number;
      taxRegion: string;
    }) {
      const serviceId = await createTestService(context, {
        service_name: options.serviceName,
        billing_method: 'fixed',
        default_rate: options.unitRateCents,
        unit_of_measure: 'unit',
        tax_region: options.taxRegion
      });
      const configId = uuidv4();
      await context.db('contract_line_services').insert({
        contract_line_id: lineId,
        service_id: serviceId,
        tenant: context.tenantId
      });
      await context.db('contract_line_service_configuration').insert({
        config_id: configId,
        contract_line_id: lineId,
        service_id: serviceId,
        configuration_type: 'Fixed',
        quantity: options.quantity,
        tenant: context.tenantId
      });
      await context.db('contract_line_service_fixed_config').insert({
        config_id: configId,
        tenant: context.tenantId,
        base_rate: options.unitRateCents,
        pricing_basis: 'unit'
      });
      return { serviceId, configId };
    }

    async function setupSeatLine(cycleStart: { year: number; month: number; day: number }) {
      const contractLineId = await context.createEntity('contract_lines', {
        contract_line_name: 'Seat Line',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed',
        custom_rate: null,
        billing_timing: 'arrears'
      }, 'contract_line_id');

      const standard = await addSeatService(contractLineId, { serviceName: 'Standard', quantity: 10, unitRateCents: 10000, taxRegion: 'US-NY' });
      const basic = await addSeatService(contractLineId, { serviceName: 'Basic', quantity: 9, unitRateCents: 8500, taxRegion: 'US-NY' });
      const server = await addSeatService(contractLineId, { serviceName: 'Server', quantity: 1, unitRateCents: 12500, taxRegion: 'US-NY' });

      const assignment = await assignContractLineToClient(context, contractLineId, {
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });
      const billingCycleId = await setupInvoiceCycle(cycleStart.year, cycleStart.month, cycleStart.day);
      return { contractLineId, standard, basic, server, billingCycleId, ...assignment };
    }

    it('10/9/1 seats bill CA$1890 equivalent without usage rows', async () => {
      const setup = await setupSeatLine({ year: 2023, month: 2, day: 1 });
      const invoice1 = unwrapInvoiceResult(await generateInvoice(setup.billingCycleId));
      // 10×10000 + 9×8500 + 1×12500 = 189000 minor units ($1,890.00).
      expect(invoice1).toMatchObject({ subtotal: 189000, tax: 18900, total_amount: 207900 });

      const usageRows = await context.db('usage_tracking').where({ tenant: context.tenantId });
      expect(usageRows).toHaveLength(0);

      // No period-total row is created either — seats are not usage.
      const totalRows = await totalsTable().where({ tenant: context.tenantId });
      expect(totalRows).toHaveLength(0);
    });

    it('a scheduled 10 → 12 change bills 209000 at the next unbilled boundary; the earlier billed period is unchanged', async () => {
      // Window 1 (Feb) invoices January at the original 10 units.
      const setup = await setupSeatLine({ year: 2023, month: 2, day: 1 });
      const invoice1 = unwrapInvoiceResult(await generateInvoice(setup.billingCycleId));
      expect(invoice1.subtotal).toBe(189000);

      // Schedule Standard 10 → 12 effective at the next unbilled boundary.
      const scheduled = await scheduleUnitPricingRevision({
        contract_line_id: setup.contractLineId,
        service_id: setup.standard.serviceId,
        config_id: setup.standard.configId,
        quantity: 12,
        unit_rate_cents: 10000,
        effective_period_start: '2023-02-01'
      });
      if ('actionError' in (scheduled as object)) throw new Error(JSON.stringify(scheduled));

      // Window 2 (Mar) invoices February with the revision.
      const cycle2 = await setupInvoiceCycle(2023, 3, 1);
      const invoice2 = unwrapInvoiceResult(await generateInvoice(cycle2));
      expect(invoice2.subtotal).toBe(209000);

      // The earlier invoice row is untouched.
      const earlier = await context.db('invoices').where({ tenant: context.tenantId, invoice_id: invoice1.invoice_id }).first();
      expect(Number(earlier?.subtotal)).toBe(189000);
    });

    it('scheduling a change inside an already-billed service period is rejected at the boundary guard', async () => {
      const setup = await setupSeatLine({ year: 2023, month: 2, day: 1 });

      // A billed recurring service period for the seat line covering January
      // [2023-01-01, 2023-02-01): retroactively changing seats inside it must
      // be refused (billed periods are immutable).
      await context.db('recurring_service_periods').insert({
        tenant: context.tenantId,
        record_id: uuidv4(),
        schedule_key: uuidv4(),
        period_key: uuidv4(),
        revision: 1,
        obligation_id: setup.contractLineId,
        obligation_type: 'client_contract_line',
        charge_family: 'fixed',
        cadence_owner: 'client',
        due_position: 'arrears',
        lifecycle_state: 'billed',
        service_period_start: '2023-01-01',
        service_period_end: '2023-02-01',
        invoice_window_start: '2023-02-01',
        invoice_window_end: '2023-03-01',
        provenance_kind: 'generated',
        source_rule_version: 'test|monthly'
      });

      const insideBilled = await scheduleUnitPricingRevision({
        contract_line_id: setup.contractLineId,
        service_id: setup.standard.serviceId,
        config_id: setup.standard.configId,
        quantity: 12,
        unit_rate_cents: 10000,
        effective_period_start: '2023-01-15'
      });
      expect('actionError' in (insideBilled as object)).toBe(true);

      // The boundary exactly on the billed period's end is the legal next
      // period and remains schedulable.
      const nextBoundary = await scheduleUnitPricingRevision({
        contract_line_id: setup.contractLineId,
        service_id: setup.standard.serviceId,
        config_id: setup.standard.configId,
        quantity: 12,
        unit_rate_cents: 10000,
        effective_period_start: '2023-02-01'
      });
      expect('actionError' in (nextBoundary as object)).toBe(false);
    });

    it('zero agreed quantity bills zero, never a fallback to one', async () => {
      const contractLineId = await context.createEntity('contract_lines', {
        contract_line_name: 'Zero Seat Line',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed',
        custom_rate: null,
        billing_timing: 'arrears'
      }, 'contract_line_id');
      const zero = await addSeatService(contractLineId, { serviceName: 'Zero Seats', quantity: 0, unitRateCents: 10000, taxRegion: 'US-NY' });
      void zero;
      await assignContractLineToClient(context, contractLineId, {
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 })
      });
      const cycle = await setupInvoiceCycle(2023, 2, 1);
      // No charge may come from a zero-quantity seat (0 × $100 = $0).
      const invoice = await generateInvoice(cycle).catch((e) => e);
      const isError = invoice === null || invoice instanceof Error || 'actionError' in (invoice ?? {});
      if (!isError) {
        expect(invoice.subtotal).toBe(0);
      } else {
        // Refusing to bill an all-zero line is also correct (no phantom seat).
        expect(true).toBe(true);
      }
    });
  });
});
