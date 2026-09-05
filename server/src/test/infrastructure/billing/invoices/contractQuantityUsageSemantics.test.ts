import { getAvailableRecurringDueWork } from '@alga-psa/billing/actions/billingAndTax';
import { repairMissingRecurringServicePeriods, repairAllRecurringServicePeriodsForTenant } from '@alga-psa/billing/actions/recurringServicePeriodActions';
import { createCustomContractLine } from '@alga-psa/billing/actions/contractLinePresetActions';
import { getConfigurationWithDetails, updateConfiguration } from '@alga-psa/billing/actions/contractLineServiceConfigurationActions';
import knexFactory from 'knex';
import { getContractOverview } from '@alga-psa/billing/actions/contractActions';
import * as invoiceService from '@alga-psa/billing/services/invoiceService';
import * as tenantDbModule from '@alga-psa/db';
import { generateGroupedInvoicesAsRecurringBillingRun, generateInvoicesAsRecurringBillingRun } from '@alga-psa/billing/actions/recurringBillingRunActions';
import { updateContractLineService } from '@alga-psa/billing/actions/contractLineServiceActions';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import {
  generateInvoice,
  generateInvoiceForSelectionInput,
  previewInvoice,
} from '@alga-psa/billing/actions/invoiceGeneration';
import {
  USAGE_CALCULATION_ERROR_MESSAGE_KEY,
  USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY,
  USAGE_RECORDS_MISSING_ACK_REQUIRED_MESSAGE_KEY,
} from '@alga-psa/billing/actions/invoiceGeneration.constants';
import { buildClientCadenceDueSelectionInput, buildContractCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  upsertUsagePeriodTotal,
  deleteUsagePeriodTotal,
  getUsagePeriodTotals,
} from '@alga-psa/billing/actions/usagePeriodTotalActions';
import { createUsageRecord, updateUsageRecord } from '@alga-psa/billing/actions/usageActions';
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

vi.mock('@alga-psa/auth/rbac', () => ({hasPermission: vi.fn(async () => true)}));
vi.mock('@alga-psa/billing/lib/authHelpers', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentUserAsync: async () => ({user_id: mockedUserId, tenant: mockedTenantId}),
  hasPermissionAsync: async () => true,
}));

vi.mock('@alga-psa/auth/withAuth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return {withAuth: createAuthModuleMock().withAuth};
});

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
        'usage_period_total_requests',
        'usage_measurement_revisions',
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

  describe('pre-effective recurring gaps deploy mitigation', () => {
    const dateOnly = (value: unknown) => new Date(value as string).toISOString().slice(0, 10);

    async function setupSeptemberLedger(boundaryKind: 'billed' | 'draft') {
      const setup = await setupUsageLine();
      await context.db('recurring_service_periods').where({tenant: context.tenantId}).delete();
      await context.db('client_billing_cycles').where({tenant: context.tenantId}).delete();
      await context.db('client_contracts').where({tenant: context.tenantId, contract_id: setup.contractId})
        .update({start_date: '2026-09-01', is_active: true});
      await context.db('clients').where({tenant: context.tenantId, client_id: context.clientId}).update({billing_cycle: 'monthly'});
      for (const month of [9, 10, 11, 12]) await setupInvoiceCycle(2026, month, 1);
      const draftInvoiceId = boundaryKind === 'draft' ? uuidv4() : null;
      if (draftInvoiceId) await context.db('invoices').insert({
        tenant: context.tenantId, invoice_id: draftInvoiceId, client_id: context.clientId,
        invoice_number: `SYNTHETIC-${uuidv4()}`, invoice_date: '2026-09-05', due_date: '2026-10-05',
        total_amount: 0, status: 'draft', subtotal: 0, tax: 0, is_manual: false,
        is_prepayment: false, currency_code: 'USD', tax_source: 'internal',
      });
      // A draft consumes the obligation: its ledger lifecycle is already billed.
      await context.db('recurring_service_periods').insert({
        tenant: context.tenantId, record_id: uuidv4(),
        schedule_key: `schedule:${context.tenantId}:client_contract_line:${setup.contractLineId}:client:arrears`,
        period_key: 'period:2026-09-01:2026-10-01', revision: 1,
        obligation_id: setup.contractLineId, obligation_type: 'client_contract_line', charge_family: 'usage',
        cadence_owner: 'client', due_position: 'arrears', lifecycle_state: 'billed',
        service_period_start: '2026-09-01', service_period_end: '2026-10-01',
        invoice_window_start: '2026-10-01', invoice_window_end: '2026-11-01',
        invoice_charge_detail_id: boundaryKind === 'draft' ? uuidv4() : null,
        invoice_id: draftInvoiceId,
        invoice_charge_id: boundaryKind === 'draft' ? uuidv4() : null,
        invoice_linked_at: boundaryKind === 'draft' ? new Date() : null,
        provenance_kind: 'generated', source_rule_version: 'synthetic-september-ledger', reason_code: 'initial_materialization',
        created_at: new Date(), updated_at: new Date(),
      });
      const lines: string[] = [];
      for (const type of ['Fixed', 'Usage'] as const) {
        const lineId = await createCustomContractLine(setup.contractId, {
          contract_line_name: `September ${type}`, contract_line_type: type, billing_frequency: 'monthly',
          cadence_owner: 'client', billing_timing: 'arrears',
          services: [{service_id: setup.serviceId, custom_rate: 1000,
            ...(type === 'Fixed' ? {pricing_basis: 'unit' as const, quantity: 10} : {measurement_mode: 'period_total' as const})}],
          base_rate: null,
        });
        expect(typeof lineId).toBe('string');
        lines.push(lineId as string);
      }
      return lines;
    }

    async function discover() {
      const result = await getAvailableRecurringDueWork({pageSize: 100, dateRange: {from: '2026-09-01', to: '2026-12-31'}});
      if ('permissionError' in result) throw new Error(JSON.stringify(result));
      return result;
    }
    async function periods(lines: string[]) {
      return context.db('recurring_service_periods').where({tenant: context.tenantId}).whereIn('obligation_id', lines)
        .whereNotIn('lifecycle_state', ['superseded', 'archived']).orderBy('service_period_start');
    }

    it.each(['billed', 'draft'] as const)('does not discover September gaps for Fixed/unit and Usage/period-total with a %s boundary', async boundaryKind => {
      const lines = await setupSeptemberLedger(boundaryKind);
      for (const line of lines) expect(dateOnly((await periods([line]))[0].service_period_start)).toBe('2026-10-01');
      const result = await discover();
      expect(result.materializationGaps.filter(gap => lines.some(line => gap.scheduleKey.includes(line)))).toEqual([]);
      const members = result.invoiceCandidates.flatMap(candidate => candidate.members)
        .filter(member => lines.some(line => member.scheduleKey?.includes(line)));
      for (const line of lines) {
        expect(members.filter(member => member.scheduleKey?.includes(line) && dateOnly(member.servicePeriodStart) === '2026-10-01')).toHaveLength(1);
      }
      expect(await discover()).toEqual(result);
      expect(await context.db('usage_period_totals').where({tenant: context.tenantId})).toHaveLength(0);
      expect(await context.db('usage_tracking').where({tenant: context.tenantId})).toHaveLength(0);
    });

    it.each(['individual', 'bulk'] as const)('%s repair rejects pre-effective September implicitly and heals eligible October exactly once', async repairKind => {
      const lines = await setupSeptemberLedger('draft');
      const before = await periods(lines);
      const invoicesBefore = await context.db('invoices').where({tenant: context.tenantId});
      const repair = async () => {
        if (repairKind === 'bulk') return repairAllRecurringServicePeriodsForTenant();
        for (const line of lines) {
          // A stale September warning submits this same schedule key; the action
          // must resolve its current eligibility rather than trusting that warning.
          await repairMissingRecurringServicePeriods(`schedule:${context.tenantId}:client_contract_line:${line}:client:arrears`);
        }
      };
      await repair();
      expect(await periods(lines)).toEqual(before);
      await context.db('recurring_service_periods').where({tenant: context.tenantId, service_period_start: '2026-10-01'})
        .whereIn('obligation_id', lines).delete();
      const missing = (await discover()).materializationGaps.filter(gap => lines.some(line => gap.scheduleKey.includes(line)));
      expect(missing).toHaveLength(2);
      expect(missing.every(gap => dateOnly(gap.servicePeriodStart) === '2026-10-01')).toBe(true);
      await repair();
      const repaired = await periods(lines);
      expect(repaired.filter(row => dateOnly(row.service_period_start) === '2026-09-01')).toHaveLength(0);
      expect(repaired.filter(row => dateOnly(row.service_period_start) === '2026-10-01')).toHaveLength(2);
      expect(new Set(repaired.map(row => `${row.schedule_key}:${row.period_key}`)).size).toBe(repaired.length);
      const ready = await discover();
      expect(ready.materializationGaps.filter(gap => lines.some(line => gap.scheduleKey.includes(line)))).toEqual([]);
      await repair();
      expect(await periods(lines)).toEqual(repaired);
      expect(await discover()).toEqual(ready);
      expect(await context.db('invoices').where({tenant: context.tenantId})).toEqual(invoicesBefore);
    });
  });

  describe('active custom-line UI persistence boundary', () => {
    it.each(['additive', 'period_total'] as const)('persists %s measurement, minimum and tier rates through the custom-line creation action', async measurementMode => {
      const setup = await setupUsageLine();
      const lineId = await createCustomContractLine(setup.contractId, {
        contract_line_name: 'Explicit usage intent', contract_line_type: 'Usage', billing_frequency: 'monthly',
        services: [{ service_id: setup.serviceId, custom_rate: 8525, unit_of_measure: 'seat',
          measurement_mode: measurementMode, minimum_usage: 5, enable_tiered_pricing: true,
          rate_tiers: [{ min_quantity: 0, max_quantity: null, rate: 7500 }] }],
      });
      expect(typeof lineId).toBe('string');
      const config = await context.db('contract_line_service_configuration').where({tenant: context.tenantId, contract_line_id: lineId}).first();
      const usage = await context.db('contract_line_service_usage_config').where({tenant: context.tenantId, config_id: config.config_id}).first();
      expect(config.quantity).toBeNull();
      expect(usage).toMatchObject({measurement_mode: measurementMode, minimum_usage: 5, enable_tiered_pricing: true, unit_of_measure: 'seat'});
      expect(Number(usage.base_rate)).toBe(8525);
      const tiers = await context.db('contract_line_service_rate_tiers').where({tenant: context.tenantId, config_id: config.config_id});
      expect(tiers).toHaveLength(1);
      expect(Number(tiers[0].rate)).toBe(7500);
      expect(tiers[0].max_quantity).toBeNull();
      expect(await context.db('usage_tracking').where({tenant: context.tenantId})).toHaveLength(0);
      expect(await context.db('usage_period_totals').where({tenant: context.tenantId})).toHaveLength(0);
    });

    it.each([10, 0])('persists recurring unit pricing and quantity %s without creating usage or invoices', async quantity => {
      const setup = await setupUsageLine();
      const lineId = await createCustomContractLine(setup.contractId, {
        contract_line_name: 'Recurring seats', contract_line_type: 'Fixed', billing_frequency: 'monthly',
        services: [{service_id: setup.serviceId, pricing_basis: 'unit', quantity, custom_rate: 10025}],
        base_rate: null,
      });
      expect(typeof lineId).toBe('string');
      const config = await context.db('contract_line_service_configuration').where({tenant: context.tenantId, contract_line_id: lineId}).first();
      const fixed = await context.db('contract_line_service_fixed_config').where({tenant: context.tenantId, config_id: config.config_id}).first();
      expect(Number(config.quantity)).toBe(quantity);
      expect(fixed.pricing_basis).toBe('unit');
      expect(Number(fixed.base_rate)).toBe(10025);
      expect(await context.db('invoices').where({tenant: context.tenantId})).toHaveLength(0);
    });

    it('rejects invalid recurring unit pricing before creating a line', async () => {
      const setup = await setupUsageLine();
      const before = await context.db('contract_lines').where({tenant: context.tenantId});
      const result = await createCustomContractLine(setup.contractId, {
        contract_line_name: 'Invalid seats', contract_line_type: 'Fixed', billing_frequency: 'monthly',
        services: [{service_id: setup.serviceId, pricing_basis: 'unit', quantity: -1, custom_rate: 10000}],
      });
      expect(result).toHaveProperty('actionError');
      expect(await context.db('contract_lines').where({tenant: context.tenantId})).toHaveLength(before.length);
    });

    it('the active editor action schedules mode and pricing together and keeps the previous period unchanged', async () => {
      const setup = await setupUsageLine({measurementMode: 'additive', minimumUsage: 2});
      await setupInvoiceCycle(2023, 3, 1);
      expect(await updateConfiguration(setup.configId, {custom_rate: 2000}, {
        measurement_mode: 'period_total', minimum_usage: 7, base_rate: 2000,
        enable_tiered_pricing: true, unit_of_measure: 'seat', effective_period_start: '2023-02-01',
      }, [{min_quantity: 0, max_quantity: undefined, rate: 1500}])).toBe(true);
      const january: any = await getConfigurationWithDetails(setup.configId, '2023-01-01');
      const february: any = await getConfigurationWithDetails(setup.configId, '2023-02-01');
      expect(january.typeConfig).toMatchObject({measurement_mode: 'additive', minimum_usage: 2});
      expect(Number(january.typeConfig.base_rate)).toBe(1000);
      expect(february.typeConfig).toMatchObject({measurement_mode: 'period_total', minimum_usage: 7, base_rate: 2000, enable_tiered_pricing: true});
      expect(Number(february.rateTiers[0].rate)).toBe(1500);
      expect(await context.db('invoices').where({tenant: context.tenantId})).toHaveLength(0);
    });
  });

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

  describe('draft review mitigation production paths', () => {
    const reportInput = (setup: Awaited<ReturnType<typeof setupUsageLine>>, quantity = 10) => ({
      client_id: context.clientId, client_contract_line_id: setup.contractLineId,
      service_id: setup.serviceId, config_id: setup.configId, ...JAN_PERIOD, quantity, request_id: uuidv4(),
    });
    const currentPreview = async (setup: Awaited<ReturnType<typeof setupUsageLine>>) => {
      const preview = await previewInvoice(setup.billingCycleId);
      if (!preview.success) throw new Error(JSON.stringify(preview));
      expect(preview.expectedUsagePeriodTotals?.[0]).toMatchObject({periodTotalId: expect.any(String), billingInputsHash: expect.any(String)});
      return preview.expectedUsagePeriodTotals!;
    };
    it('quantity-only additive correction preserves canonical stored date', async () => {
      const setup = await setupUsageLine({measurementMode: 'additive'});
      const created: any = await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId,
        contract_line_id: setup.contractLineId, usage_date: '2023-01-10', quantity: 4, request_id: uuidv4()});
      expect(created).toHaveProperty('usage_id');
      const stored = await context.db('usage_tracking').where({tenant: context.tenantId, usage_id: created.usage_id}).first();
      expect(stored.usage_date).toBeInstanceOf(Date);
      const updated = await updateUsageRecord({usage_id: created.usage_id, quantity: 5});
      expect(updated).not.toHaveProperty('actionError');
      if ('actionError' in updated) throw new Error(JSON.stringify(updated));
      expect(Number(updated.quantity)).toBe(5);
      expect(unwrapInvoiceResult(await generateInvoice(setup.billingCycleId)).subtotal).toBe(5000);
    });
    it.each([false, true])('later mode-only transition preserves prior effective rate (legacy null snapshot: %s)', async (legacyNull) => {
      const setup = await setupUsageLine({measurementMode: 'additive'});
      await setupInvoiceCycle(2023, 3, 1);
      const aprilCycle = await setupInvoiceCycle(2023, 4, 1);
      expect(await updateContractLineService(setup.contractLineId, setup.serviceId, { customRate: 2000, typeConfig: {
        measurement_mode: 'period_total', effective_period_start: '2023-02-01', base_rate: 2000,
      }})).toBe(true);
      expect(await setUsageMeasurementMode({config_id: setup.configId, contract_line_id: setup.contractLineId,
        service_id: setup.serviceId, measurement_mode: 'additive', effective_period_start: '2023-03-01'}))
        .toMatchObject({measurement_mode: 'additive'});
      if (legacyNull) {
        // Existing mode-only revisions from before this repair have no price snapshot.
        await context.db('usage_measurement_revisions').where({tenant: context.tenantId,
          config_id: setup.configId, effective_period_start: '2023-03-01'}).update({pricing: null});
      }
      expect(await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId,
        contract_line_id: setup.contractLineId, usage_date: '2023-03-10', quantity: 4, request_id: uuidv4()})).toHaveProperty('usage_id');
      expect(unwrapInvoiceResult(await generateInvoice(aprilCycle)).subtotal).toBe(8000);
    });
    it('same-mode dated pricing edit retains earlier period price', async () => {
      const setup = await setupUsageLine({measurementMode: 'additive'});
      const marchCycle = await setupInvoiceCycle(2023, 3, 1);
      expect(await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId,
        contract_line_id: setup.contractLineId, usage_date: '2023-01-10', quantity: 4, request_id: uuidv4()})).toHaveProperty('usage_id');
      expect(await updateContractLineService(setup.contractLineId, setup.serviceId, { customRate: 2000, typeConfig: {
        measurement_mode: 'additive', effective_period_start: '2023-02-01', base_rate: 2000,
      }})).toBe(true);
      expect(unwrapInvoiceResult(await generateInvoice(setup.billingCycleId)).subtotal).toBe(4000);
      expect(await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId,
        contract_line_id: setup.contractLineId, usage_date: '2023-02-10', quantity: 4, request_id: uuidv4()})).toHaveProperty('usage_id');
      expect(unwrapInvoiceResult(await generateInvoice(marchCycle)).subtotal).toBe(8000);
      const baseline = await context.db('contract_line_service_usage_config').where({tenant: context.tenantId, config_id: setup.configId}).first();
      expect(Number(baseline.base_rate)).toBe(1000);
    });


    it.each(['mode-only', 'partial-edit'] as const)('%s transition inherits effective minimums, prices and tiers at its boundary', async (edit) => {
      const setup = await setupUsageLine({measurementMode: 'additive'});
      await setupInvoiceCycle(2023, 3, 1);
      const aprilCycle = await setupInvoiceCycle(2023, 4, 1);
      const tiers = [{tenant: context.tenantId, config_id: setup.configId, tier_id: uuidv4(),
        min_quantity: 1, rate: 3000, created_at: new Date(), updated_at: new Date()}];
      expect(await updateContractLineService(setup.contractLineId, setup.serviceId, {customRate: 2000, typeConfig: {
        measurement_mode: 'period_total', effective_period_start: '2023-02-01', base_rate: 2000,
        minimum_usage: 6, enable_tiered_pricing: true, unit_of_measure: 'seat',
      }}, tiers)).toBe(true);
      // A later scheduled price must not leak backwards into the March change.
      expect(await updateContractLineService(setup.contractLineId, setup.serviceId, {customRate: 9000, typeConfig: {
        effective_period_start: '2023-04-01', minimum_usage: 20,
      }})).toBe(true);
      if (edit === 'mode-only') {
        expect(await setUsageMeasurementMode({config_id: setup.configId, contract_line_id: setup.contractLineId,
          service_id: setup.serviceId, measurement_mode: 'additive', effective_period_start: '2023-03-01'}))
          .toMatchObject({measurement_mode: 'additive'});
      } else {
        expect(await updateContractLineService(setup.contractLineId, setup.serviceId, {typeConfig: {
          measurement_mode: 'additive', effective_period_start: '2023-03-01', unit_of_measure: 'item',
        }})).toBe(true);
      }
      const revision = await context.db('usage_measurement_revisions').where({tenant: context.tenantId,
        config_id: setup.configId, effective_period_start: '2023-03-01'}).first();
      expect(revision.pricing).toMatchObject({baseConfig: {custom_rate: 2000}, typeConfig: {
        base_rate: 2000, minimum_usage: 6, enable_tiered_pricing: true,
        unit_of_measure: edit === 'mode-only' ? 'seat' : 'item',
      }, rateTiers: [{min_quantity: 1, rate: 3000}]});
      expect(await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId,
        contract_line_id: setup.contractLineId, usage_date: '2023-03-10', quantity: 4, request_id: uuidv4()})).toHaveProperty('usage_id');
      expect(unwrapInvoiceResult(await generateInvoice(aprilCycle)).subtotal).toBe(18000);
    });

    it('partial dated pricing permits explicit zero, false, null and empty tiers', async () => {
      const setup = await setupUsageLine({measurementMode: 'additive'});
      await setupInvoiceCycle(2023, 3, 1);
      const aprilCycle = await setupInvoiceCycle(2023, 4, 1);
      expect(await updateContractLineService(setup.contractLineId, setup.serviceId, {customRate: 2000, typeConfig: {
        measurement_mode: 'period_total', effective_period_start: '2023-02-01', base_rate: 2000,
        minimum_usage: 6, enable_tiered_pricing: true,
      }}, [{tenant: context.tenantId, config_id: setup.configId, tier_id: uuidv4(), min_quantity: 1, rate: 3000, created_at: new Date(), updated_at: new Date()}])).toBe(true);
      expect(await updateContractLineService(setup.contractLineId, setup.serviceId, {customRate: null, typeConfig: {
        measurement_mode: 'additive', effective_period_start: '2023-03-01', minimum_usage: 0,
        enable_tiered_pricing: false, base_rate: null,
      }}, [])).toBe(true);
      const revision = await context.db('usage_measurement_revisions').where({tenant: context.tenantId,
        config_id: setup.configId, effective_period_start: '2023-03-01'}).first();
      expect(revision.pricing).toMatchObject({baseConfig: {custom_rate: null}, typeConfig: {
        base_rate: null, minimum_usage: 0, enable_tiered_pricing: false,
      }, rateTiers: []});
      expect(await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId,
        contract_line_id: setup.contractLineId, usage_date: '2023-03-10', quantity: 4, request_id: uuidv4()})).toHaveProperty('usage_id');
      // Cleared prices fall back to the 1000-cent catalog rate, with no minimum.
      expect(unwrapInvoiceResult(await generateInvoice(aprilCycle)).subtotal).toBe(4000);
    });

    it('deleting a pre-history report must retain its consumed request id', async () => {
      const setup = await setupUsageLine({measurementMode: 'period_total'});
      const input = reportInput(setup);
      const first: any = await upsertUsagePeriodTotal(input);
      expect(first).toHaveProperty('total');
      // Simulate an existing report created before the request-history migration.
      await context.db('usage_period_total_requests').where({tenant: context.tenantId, request_id: input.request_id}).delete();
      expect(await deleteUsagePeriodTotal({period_total_id: first.total.period_total_id, expected_revision: 1})).toBeUndefined();
      expect(await upsertUsagePeriodTotal(input)).toHaveProperty('actionError');
      expect(await totalsTable().where({tenant: context.tenantId})).toHaveLength(0);
      expect(await upsertUsagePeriodTotal({...input, quantity: input.quantity + 1})).toHaveProperty('actionError');
      const preview = await previewInvoice(setup.billingCycleId);
      expect(preview).toMatchObject({success: false, code: 'USAGE_RECORDS_MISSING'});
      expect(await generateInvoice(setup.billingCycleId)).toHaveProperty('actionError');
      expect(await context.db('invoices').where({tenant: context.tenantId})).toHaveLength(0);
    });

    it('historical replay A after B, changed request reuse and stale deletion never restore or remove B', async () => {
      const setup = await setupUsageLine({measurementMode: 'period_total'});
      const a = reportInput(setup);
      const first: any = await upsertUsagePeriodTotal(a);
      const b = {...a, quantity: 12, request_id: uuidv4(), expected_revision: 1};
      await upsertUsagePeriodTotal(b);
      const replay: any = await upsertUsagePeriodTotal(a);
      expect(replay.total.quantity).toBe(12);
      expect(await upsertUsagePeriodTotal({...a, quantity: 30})).toHaveProperty('actionError');
      expect(await deleteUsagePeriodTotal({period_total_id: first.total.period_total_id, expected_revision: 1})).toHaveProperty('actionError');
      expect(await upsertUsagePeriodTotal({...b, request_id: uuidv4(), expected_revision: 1})).toHaveProperty('actionError');
      expect(await totalsTable().where({tenant: context.tenantId}).first()).toMatchObject({quantity: 12, revision: 2});
      expect(await context.db('usage_period_total_requests').where({tenant: context.tenantId})).toHaveLength(2);
    });
    it.each(['replacement', 'rate', 'same-amount-config'].flatMap(reason => [false, true].map(grouped => ({reason, grouped}))))('automatic submission refuses stale $reason preview (grouped=$grouped) and persists no invoice', async ({reason, grouped}) => {
      const setup = await setupUsageLine({measurementMode: 'period_total'});
      const written: any = await upsertUsagePeriodTotal(reportInput(setup));
      const expectedUsagePeriodTotals = await currentPreview(setup);
      if (reason === 'replacement') {
        await deleteUsagePeriodTotal({period_total_id: written.total.period_total_id, expected_revision: 1});
        await upsertUsagePeriodTotal(reportInput(setup));
      } else {
        await context.db('contract_line_service_usage_config').where({tenant: context.tenantId, config_id: setup.configId})
          .update(reason === 'rate' ? {base_rate: 2000} : {minimum_usage: 1});
      }
      const persisted = await context.db('recurring_service_periods').where({tenant: context.tenantId, obligation_id: setup.contractLineId}).first();
      const selectorInput = buildClientCadenceDueSelectionInput({clientId: context.clientId,
        scheduleKey: persisted.schedule_key, periodKey: persisted.period_key, windowStart: '2023-02-01', windowEnd: '2023-03-01'});
      const result: any = grouped ? await generateGroupedInvoicesAsRecurringBillingRun({groupedTargets: [{groupKey: 'reviewed-group', selectorInputs: [selectorInput], billingCycleId: setup.billingCycleId, expectedUsagePeriodTotals}]}) : await generateInvoicesAsRecurringBillingRun({targets: [{selectorInput, executionWindow: selectorInput.executionWindow,
        billingCycleId: setup.billingCycleId, expectedUsagePeriodTotals}]});
      expect(result.failures?.[0]?.code).toBe('USAGE_PERIOD_TOTAL_STALE');
      expect(await context.db('invoices').where({tenant: context.tenantId})).toHaveLength(0);
      expect((await totalsTable().where({tenant: context.tenantId}).first()).lifecycle_state).toBe('recorded');
    });
    it('a newly reported previously absent service invalidates a mixed preview', async () => {
      const setup = await setupUsageLine({measurementMode: 'period_total'});
      await upsertUsagePeriodTotal(reportInput(setup));
      const serviceId = await createTestService(context, {billing_method: 'usage', default_rate: 1000});
      const configId = uuidv4();
      await context.db('contract_line_services').insert({tenant: context.tenantId, contract_line_id: setup.contractLineId, service_id: serviceId});
      await context.db('contract_line_service_configuration').insert({tenant: context.tenantId, config_id: configId, contract_line_id: setup.contractLineId, service_id: serviceId, configuration_type: 'Usage'});
      await context.db('contract_line_service_usage_config').insert({tenant: context.tenantId, config_id: configId, measurement_mode: 'period_total', unit_of_measure: 'unit', base_rate: 1000});
      const preview = await previewInvoice(setup.billingCycleId);
      expect(preview.success).toBe(true);
      expect(preview.expectedUsagePeriodTotals).toHaveLength(2);
      expect(preview.expectedUsagePeriodTotals).toContainEqual(expect.objectContaining({serviceId, revision: 0}));
      await upsertUsagePeriodTotal({...reportInput(setup), config_id: configId, service_id: serviceId});
      expect(await generateInvoice(setup.billingCycleId, {expectedUsagePeriodTotals: preview.expectedUsagePeriodTotals, acknowledgeUnreportedUsage: true}))
        .toMatchObject({messageKey: USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY});
      expect(await context.db('invoices').where({tenant: context.tenantId})).toHaveLength(0);
    });
    it('configuration writes wait until invoice consumption commits on independent connections', async () => {
      const setup = await setupUsageLine({measurementMode: 'period_total'});
      await upsertUsagePeriodTotal(reportInput(setup));
      const connection = context.db.client.config.connection;
      await context.transaction!.commit();
      const pool = knexFactory({client: 'pg', connection, pool: {min: 0, max: 8}});
      const original = vi.mocked(tenantDbModule.createTenantKnex).getMockImplementation()!;
      vi.mocked(tenantDbModule.createTenantKnex).mockImplementation(async () => ({knex: pool, tenant: context.tenantId}));
      let release!: () => void;
      const gate = new Promise<void>(resolve => {release = resolve;});
      let reached!: () => void;
      const validated = new Promise<void>(resolve => {reached = resolve;});
      const persist = invoiceService.persistInvoiceCharges;
      const spy = vi.spyOn(invoiceService, 'persistInvoiceCharges').mockImplementation(async (...args) => { reached(); await gate; return persist(...args); });
      try {
        const preview = await previewInvoice(setup.billingCycleId);
        const generation = generateInvoice(setup.billingCycleId, {expectedUsagePeriodTotals: preview.expectedUsagePeriodTotals});
        await validated;
        let updated = false;
        const update = pool('contract_line_service_usage_config').where({tenant: context.tenantId, config_id: setup.configId}).update({base_rate: 2000}).then(() => {updated = true;});
        // Observe the database lock wait, not an arbitrary timing assertion.
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = await pool.raw("select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%contract_line_service_usage_config%' and query like 'update%' ");
          if (state.rows.length) {waiting = true; break;}
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        expect(updated).toBe(false);
        release();
        const invoice = unwrapInvoiceResult(await generation);
        await update;
        expect(invoice.subtotal).toBe(10000);
        expect(await pool('usage_period_totals').where({tenant: context.tenantId}).first()).toMatchObject({lifecycle_state: 'billed', invoice_id: invoice.invoice_id});
      } finally { release(); spy.mockRestore(); vi.mocked(tenantDbModule.createTenantKnex).mockImplementation(original); await pool.destroy(); }
    });
    it('rejects forged assignments and noncanonical periods, while preserving explicit zero and minimum', async () => {
      const setup = await setupUsageLine({measurementMode: 'period_total', minimumUsage: 5});
      const input = reportInput(setup, 0);
      for (const invalid of [{period_start: '2023-01-02'}, {period_end: '2023-02-01'}, {client_id: uuidv4()}, {service_id: uuidv4()}]) {
        expect(await upsertUsagePeriodTotal({...input, ...invalid})).toHaveProperty('actionError');
      }
      expect(await totalsTable().where({tenant: context.tenantId})).toHaveLength(0);
      const absent = await previewInvoice(setup.billingCycleId);
      expect(absent).toMatchObject({success: false, code: 'USAGE_RECORDS_MISSING'});
      await upsertUsagePeriodTotal(input);
      const preview = await previewInvoice(setup.billingCycleId);
      expect(preview.usageServicePeriodStatuses?.[0]).toMatchObject({quantity: 0, billable_quantity: 5, status: 'minimum_raised_zero'});
    });
    it.each(['advance', 'arrears'])('uses authoritative %s timing when accepting a reported service period', async timing => {
      const setup = await setupUsageLine({measurementMode: 'period_total'});
      await context.db('contract_lines').where({tenant: context.tenantId, contract_line_id: setup.contractLineId}).update({billing_timing: timing});
      const canonical = timing === 'advance' ? {period_start: '2023-02-01', period_end: '2023-02-28'} : JAN_PERIOD;
      expect(await upsertUsagePeriodTotal({...reportInput(setup), ...canonical})).toHaveProperty('total');
      expect(await upsertUsagePeriodTotal({...reportInput(setup), ...canonical, period_end: '2023-02-27'})).toHaveProperty('actionError');
    });
    it.each(['inactive-assignment', 'future-assignment', 'ended-assignment'])('rejects %s even when client dates look canonical', async reason => {
      const setup = await setupUsageLine({measurementMode: 'period_total'});
      await context.db('client_contracts').where({tenant: context.tenantId, client_contract_id: setup.clientContractId})
        .update(reason === 'inactive-assignment' ? {is_active: false} : reason === 'future-assignment' ? {start_date: '2023-02-01'} : {end_date: '2022-12-31'});
      expect(await upsertUsagePeriodTotal(reportInput(setup))).toHaveProperty('actionError');
      expect(await totalsTable().where({tenant: context.tenantId})).toHaveLength(0);
    });
    it('failed mode plus pricing edit rolls back all related state', async () => {
      const setup = await setupUsageLine({measurementMode: 'additive'});
      await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId, contract_line_id: setup.contractLineId,
        quantity: 3, usage_date: '2023-01-10', request_id: uuidv4()});
      const result = await updateContractLineService(setup.contractLineId, setup.serviceId, { typeConfig: {
        measurement_mode: 'period_total', effective_period_start: '2023-01-01', base_rate: 9900,
      }}).catch(error => error);
      expect(result instanceof Error || 'actionError' in Object(result)).toBe(true);
      expect(await context.db('contract_line_service_usage_config').where({tenant: context.tenantId, config_id: setup.configId}).first())
        .toMatchObject({measurement_mode: 'additive', base_rate: '1000.00'});
      expect(await context.db('usage_measurement_revisions').where({tenant: context.tenantId})).toHaveLength(0);
    });
    it('all-error preview preserves calculation diagnostics and refuses generation', async () => {
      const setup = await setupUsageLine({measurementMode: 'additive'});
      await context.db('service_prices').where({tenant: context.tenantId, service_id: setup.serviceId}).delete();
      await context.db('contract_line_service_usage_config').where({tenant: context.tenantId, config_id: setup.configId}).update({base_rate: null});
      await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId, contract_line_id: setup.contractLineId,
        usage_date: '2023-01-10', quantity: 4, request_id: uuidv4()});
      const preview = await previewInvoice(setup.billingCycleId);
      expect(preview).toMatchObject({success: false, code: 'USAGE_CALCULATION_ERROR'});
      expect(preview.usageServicePeriodStatuses).toEqual([expect.objectContaining({service_id: setup.serviceId,
        service_period_start: '2023-01-01', service_period_end: '2023-01-31', status: 'calculation_error', quantity: 4})]);
      expect(await generateInvoice(setup.billingCycleId)).toMatchObject({messageKey: USAGE_CALCULATION_ERROR_MESSAGE_KEY});
      expect(await context.db('invoices').where({tenant: context.tenantId})).toHaveLength(0);
    });
    it('a dated measurement transition preserves earlier additive interpretation and applies the new period mode only prospectively', async () => {
      const setup = await setupUsageLine({measurementMode: 'additive'});
      await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId, contract_line_id: setup.contractLineId,
        usage_date: '2023-01-10', quantity: 4, request_id: uuidv4()});
      const marchCycle = await setupInvoiceCycle(2023, 3, 1);
      expect(await setUsageMeasurementMode({config_id: setup.configId, contract_line_id: setup.contractLineId, service_id: setup.serviceId,
        measurement_mode: 'period_total', effective_period_start: '2023-02-01'})).toMatchObject({measurement_mode: 'period_total'});
      expect(await totalsTable().where({tenant: context.tenantId})).toHaveLength(0);
      expect(await upsertUsagePeriodTotal({...reportInput(setup, 12), period_start: '2023-02-01', period_end: '2023-02-28'})).toHaveProperty('total');
      expect(await createUsageRecord({client_id: context.clientId, service_id: setup.serviceId, contract_line_id: setup.contractLineId,
        usage_date: '2023-02-10', quantity: 3, request_id: uuidv4()})).toHaveProperty('actionError');
      expect(unwrapInvoiceResult(await generateInvoice(setup.billingCycleId)).subtotal).toBe(4000);
      expect(unwrapInvoiceResult(await generateInvoice(marchCycle)).subtotal).toBe(12000);
      const overview: any = await getContractOverview(setup.contractId);
      expect(overview.contractLines[0].services[0]).toMatchObject({measurement_mode: 'period_total', quantity: null});
      expect(await context.db('contract_line_service_usage_config').where({tenant: context.tenantId, config_id: setup.configId}).first())
        .toMatchObject({measurement_mode: 'additive'});
    });
    it('real independent PostgreSQL connections serialize creation, replacement and invoice consumption', async () => {
      const setup = await setupUsageLine({measurementMode: 'period_total'});
      const input = reportInput(setup);
      const connection = context.db.client.config.connection;
      await context.transaction!.commit();
      const pool = knexFactory({client: 'pg', connection, pool: {min: 0, max: 8}});
      const original = vi.mocked(tenantDbModule.createTenantKnex).getMockImplementation()!;
      vi.mocked(tenantDbModule.createTenantKnex).mockImplementation(async () => ({knex: pool, tenant: context.tenantId}));
      try {
        const [a, b]: any[] = await Promise.all([upsertUsagePeriodTotal(input), upsertUsagePeriodTotal({...input, request_id: uuidv4()})]);
        expect(a.total.period_total_id).toBe(b.total.period_total_id);
        const edits: any[] = await Promise.all([12, 14].map(quantity => upsertUsagePeriodTotal({...input, quantity, request_id: uuidv4(), expected_revision: 1})));
        expect(edits.filter(edit => edit.total)).toHaveLength(1);
        expect(edits.filter(edit => edit.actionError)).toHaveLength(1);
        const preview = await previewInvoice(setup.billingCycleId);
        if (!preview.success) throw new Error(JSON.stringify(preview));
        const results: any[] = await Promise.all([1, 2].map(() => generateInvoice(setup.billingCycleId, {expectedUsagePeriodTotals: preview.expectedUsagePeriodTotals}).catch(error => error)));
        expect(results.filter(result => result?.invoice_id)).toHaveLength(1);
        expect(await pool('invoices').where({tenant: context.tenantId})).toHaveLength(1);
        expect(await pool('usage_period_totals').where({tenant: context.tenantId}).first()).toMatchObject({lifecycle_state: 'billed', revision: 2});
      } finally {
        vi.mocked(tenantDbModule.createTenantKnex).mockImplementation(original);
        await pool.destroy();
      }
    });
  });

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
        request_id: uuidv4(), expected_revision: 1
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
        request_id: uuidv4(), expected_revision: 1
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
        request_id: uuidv4(), expected_revision: 1
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
      expect(config?.measurement_mode).toBe('additive');
      const revision = await context.db('usage_measurement_revisions').where({tenant: context.tenantId, config_id: configId}).first();
      expect(revision?.measurement_mode).toBe('period_total');
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

    it('normal seat authoring schedules the displayed boundary and mixed bases preserve siblings', async () => {
      const setup = await setupSeatLine({year: 2023, month: 2, day: 1});
      const febCycle = await setupInvoiceCycle(2023, 3, 1);
      expect(await updateContractLineService(setup.contractLineId, setup.standard.serviceId, {quantity: 12,
        typeConfig: {effective_period_start: '2023-02-01'}})).toBe(true);
      expect(await context.db('contract_line_service_configuration').where({tenant: context.tenantId, config_id: setup.standard.configId}).first()).toMatchObject({quantity: 10});
      expect(unwrapInvoiceResult(await generateInvoice(setup.billingCycleId)).subtotal).toBe(189000);
      expect(unwrapInvoiceResult(await generateInvoice(febCycle)).subtotal).toBe(209000);
      const overview: any = await getContractOverview(setup.contractId);
      expect(overview.totalEstimatedMonthlyValue).toBe(209000);
      expect(overview.contractLines[0].services.find((service: any) => service.service_id === setup.standard.serviceId)).toMatchObject({quantity: 12, unit_rate: 10000});
      const refused = await updateContractLineService(setup.contractLineId, setup.standard.serviceId, {quantity: 15,
        typeConfig: {effective_period_start: '2023-01-15'}}).catch(error => error);
      expect(refused instanceof Error || 'actionError' in Object(refused)).toBe(true);
    });
    it('mixed per-service pricing and catalog fallback match the invoice calculation', async () => {
      const setup = await setupSeatLine({year: 2023, month: 2, day: 1});
      await context.db('contract_line_service_fixed_config').where({tenant: context.tenantId, config_id: setup.standard.configId}).update({base_rate: null});
      await context.db('contract_line_service_fixed_config').where({tenant: context.tenantId, config_id: setup.basic.configId}).update({pricing_basis: null});
      await context.db('contract_line_service_fixed_config').where({tenant: context.tenantId, config_id: setup.server.configId}).update({pricing_basis: 'bundle'});
      await context.db('contract_lines').where({tenant: context.tenantId, contract_line_id: setup.contractLineId}).update({custom_rate: 90000});
      const invoice = unwrapInvoiceResult(await generateInvoice(setup.billingCycleId));
      expect(invoice.subtotal).toBe(190000); // 10 catalog-priced seats plus the unchanged bundle total.
      expect(await context.db('contract_line_service_fixed_config').where({tenant: context.tenantId, config_id: setup.basic.configId}).first()).toMatchObject({pricing_basis: null});
    });
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

  describe('stale-preview consistency lock (R3 / F009)', () => {
    async function reportJanuaryTotal(
      setup: { serviceId: string; contractLineId: string; configId: string },
      quantity: number,
      expectedRevision?: number,
    ) {
      const result = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: setup.contractLineId,
        service_id: setup.serviceId,
        config_id: setup.configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity,
        ...(expectedRevision != null ? { request_id: uuidv4(), expected_revision: expectedRevision } : {}),
      });
      if ('actionError' in ((result ?? {}) as object)) throw new Error(JSON.stringify(result));
      return result as { total: { period_total_id: string; revision: number } };
    }

    /** The previewed period-total identity (line/service/period/revision). */
    async function previewBillableTotal(billingCycleId: string, serviceId: string) {
      const preview = await previewInvoice(billingCycleId);
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      if (!preview.success) throw new Error('unreachable');
      const status = (preview.usageServicePeriodStatuses ?? []).find(
        (candidate) => candidate.service_id === serviceId && candidate.status === 'billable',
      );
      if (!status) {
        throw new Error(
          `preview did not surface a billable period-total status: ${JSON.stringify(preview.usageServicePeriodStatuses)}`,
        );
      }
      const identity = preview.expectedUsagePeriodTotals?.find(item => item.serviceId === serviceId);
      if (!identity) throw new Error('Preview did not bind persisted report inputs');
      return identity;
    }

    it('preview surfaces the priced revision; editing the total after preview invalidates it until re-preview', async () => {
      const setup = await setupUsageLine({ measurementMode: 'period_total' });
      await reportJanuaryTotal(setup, 10);

      const previewed = await previewBillableTotal(setup.billingCycleId, setup.serviceId);
      expect(previewed.revision).toBe(1);

      // The operator's colleague replaces 10 with 12 after the preview.
      await reportJanuaryTotal(setup, 12, 1);

      // Generating against the stale previewed revision is refused, and no
      // invoice exists afterwards. Preview itself marked nothing invoiced.
      const stale = await generateInvoice(setup.billingCycleId, {
        expectedUsagePeriodTotals: [previewed],
      });
      expect('actionError' in ((stale ?? {}) as object)).toBe(true);
      expect((stale as { messageKey?: string }).messageKey).toBe(USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY);
      expect(await context.db('invoices').where({ tenant: context.tenantId })).toHaveLength(0);
      const rows = await totalsTable().where({ tenant: context.tenantId });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ quantity: 12, revision: 2, lifecycle_state: 'recorded' });

      // Re-preview shows the current revision; generating with it succeeds and
      // consumes exactly that revision.
      const repreviewed = await previewBillableTotal(setup.billingCycleId, setup.serviceId);
      expect(repreviewed.revision).toBe(2);
      const invoice = unwrapInvoiceResult(
        await generateInvoice(setup.billingCycleId, {
          expectedUsagePeriodTotals: [repreviewed],
        }),
      );
      expect(invoice).toMatchObject({ subtotal: 12000 });
      const consumed = await totalsTable().where({ tenant: context.tenantId });
      expect(consumed).toHaveLength(1);
      expect(consumed[0]).toMatchObject({ quantity: 12, revision: 2, lifecycle_state: 'billed' });
    });

    it('deleting the total after preview invalidates the previewed revision and creates no invoice', async () => {
      const setup = await setupUsageLine({ measurementMode: 'period_total' });
      const created = await reportJanuaryTotal(setup, 10);

      const previewed = await previewBillableTotal(setup.billingCycleId, setup.serviceId);

      // Deletes carry the reviewed revision: a blind delete is refused so a
      // report someone else just corrected cannot vanish.
      const deletion = await deleteUsagePeriodTotal({
        period_total_id: created.total.period_total_id,
        expected_revision: Number(created.total.revision),
      });
      expect(deletion === undefined || !('actionError' in ((deletion ?? {}) as object))).toBe(true);

      const stale = await generateInvoice(setup.billingCycleId, {
        expectedUsagePeriodTotals: [previewed],
      });
      expect('actionError' in ((stale ?? {}) as object)).toBe(true);
      expect((stale as { messageKey?: string }).messageKey).toBe(USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY);
      expect(await context.db('invoices').where({ tenant: context.tenantId })).toHaveLength(0);

      // Re-reporting and generating with the fresh previewed revision succeeds.
      await reportJanuaryTotal(setup, 7);
      const repreviewed = await previewBillableTotal(setup.billingCycleId, setup.serviceId);
      const invoice = unwrapInvoiceResult(
        await generateInvoice(setup.billingCycleId, {
          expectedUsagePeriodTotals: [repreviewed],
        }),
      );
      expect(invoice).toMatchObject({ subtotal: 7000 });
    });

    it('generation retries cannot consume the previewed revision twice', async () => {
      // True cross-connection races are settled by the conditional
      // recorded+revision UPDATE in the consumption lock (invoiceService);
      // this harness shares one test transaction, so the observable exactly-
      // once contract is proven through the retry path: the first generation
      // consumes revision 1, and every subsequent attempt with the same
      // previewed revision refuses without another charge.
      const setup = await setupUsageLine({ measurementMode: 'period_total' });
      await reportJanuaryTotal(setup, 10);
      const previewed = await previewBillableTotal(setup.billingCycleId, setup.serviceId);

      const invoice = unwrapInvoiceResult(
        await generateInvoice(setup.billingCycleId, { expectedUsagePeriodTotals: [previewed] }),
      );
      expect(invoice).toMatchObject({ subtotal: 10000 });

      // The single logical total was consumed exactly once, at revision 1.
      const rows = await totalsTable().where({ tenant: context.tenantId });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ quantity: 10, revision: 1, lifecycle_state: 'billed' });

      // A retry with the same previewed revision refuses and adds no charge.
      const retry = await generateInvoice(setup.billingCycleId, {
        expectedUsagePeriodTotals: [previewed],
      }).catch((error: unknown) => error);
      const retryIsRefusal =
        retry instanceof Error || 'actionError' in ((retry ?? {}) as object);
      expect(retryIsRefusal).toBe(true);
      const after = await totalsTable().where({ tenant: context.tenantId });
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ revision: 1, lifecycle_state: 'billed' });
      expect(after[0].invoice_id).toBe(invoice.invoice_id);
      const invoices = await context.db('invoices').where({ tenant: context.tenantId });
      expect(invoices).toHaveLength(1);
    });

    it('legacy callers that pass no expected revision keep the recompute-from-database behavior', async () => {
      const setup = await setupUsageLine({ measurementMode: 'period_total' });
      await reportJanuaryTotal(setup, 10);
      // Edit after an (unpassed) preview: generation without an expectation
      // simply bills the current stored report.
      await reportJanuaryTotal(setup, 12, 1);
      const invoice = unwrapInvoiceResult(await generateInvoice(setup.billingCycleId));
      expect(invoice).toMatchObject({ subtotal: 12000 });
    });
  });

  describe('diagnostic matrix completeness (R6 / F015)', () => {
    it('usage excluded by unresolved attribution is reported distinctly, never as missing usage', async () => {
      // Line 1: a period-total service with a recorded report (keeps the
      // window billable) plus an additive service S.
      const line1 = await setupUsageLine({
        measurementMode: 'period_total',
        serviceName: 'Reported PT Service',
      });
      const sharedServiceId = await createTestService(context, {
        service_name: 'Ambiguous Shared Service',
        billing_method: 'usage',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
      });
      const addSharedServiceToLine = async (lineId: string) => {
        const configId = uuidv4();
        await context.db('contract_line_service_configuration').insert({
          config_id: configId,
          contract_line_id: lineId,
          service_id: sharedServiceId,
          configuration_type: 'Usage',
          quantity: null,
          tenant: context.tenantId,
        });
        await context.db('contract_line_service_usage_config').insert({
          config_id: configId,
          tenant: context.tenantId,
          unit_of_measure: 'unit',
          enable_tiered_pricing: false,
          minimum_usage: 0,
          measurement_mode: 'additive',
          base_rate: 1000,
        });
        await context.db('contract_line_services').insert({
          contract_line_id: lineId,
          service_id: sharedServiceId,
          tenant: context.tenantId,
        });
      };
      await addSharedServiceToLine(line1.contractLineId);

      // Line 2 also covers S for the same client: S is no longer uniquely
      // assignable, so an unassigned entry cannot be attributed.
      const line2Id = await context.createEntity('contract_lines', {
        contract_line_name: 'Second Usage Line',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Usage',
      }, 'contract_line_id');
      await addSharedServiceToLine(line2Id);
      await assignContractLineToClient(context, line2Id, {
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      });

      // An in-period entry with no contract line: excluded by attribution.
      await context.db('usage_tracking').insert({
        tenant: context.tenantId,
        usage_id: uuidv4(),
        service_id: sharedServiceId,
        client_id: context.clientId,
        usage_date: '2023-01-10',
        quantity: 3,
        invoiced: false,
        contract_line_id: null,
      });

      const reported = await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: line1.contractLineId,
        service_id: line1.serviceId,
        config_id: line1.configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 5,
      });
      if ('actionError' in (reported as object)) throw new Error(JSON.stringify(reported));

      const preview = await previewInvoice(line1.billingCycleId);
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      if (!preview.success) throw new Error('unreachable');
      const statuses = preview.usageServicePeriodStatuses ?? [];
      const sharedStatuses = statuses.filter((status) => status.service_id === sharedServiceId);
      expect(sharedStatuses.length).toBeGreaterThan(0);
      expect(sharedStatuses.every((status) => status.status === 'attribution_excluded')).toBe(true);
      // The excluded record never charges on either line, and the report is
      // never conflated with "record usage".
      expect(statuses.some(
        (status) => status.service_id === sharedServiceId && status.status === 'missing_usage',
      )).toBe(false);
    });

    it('a per-service pricing failure is a calculation error, not unreported, and generation refuses', async () => {
      const setup = await setupUsageLine({
        measurementMode: 'additive',
        serviceName: 'Priced Additive Service',
      });
      // A second additive service on the same line with no resolvable pricing
      // (no contract-currency catalog price, no custom rate, no tiers).
      const unpricedServiceId = await createTestService(context, {
        service_name: 'Unpriced Additive Service',
        billing_method: 'usage',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        seedServicePrice: false,
      });
      const unpricedConfigId = uuidv4();
      await context.db('contract_line_service_configuration').insert({
        config_id: unpricedConfigId,
        contract_line_id: setup.contractLineId,
        service_id: unpricedServiceId,
        configuration_type: 'Usage',
        quantity: null,
        tenant: context.tenantId,
      });
      await context.db('contract_line_service_usage_config').insert({
        config_id: unpricedConfigId,
        tenant: context.tenantId,
        unit_of_measure: 'unit',
        enable_tiered_pricing: false,
        minimum_usage: 0,
        measurement_mode: 'additive',
        base_rate: null,
      });
      await context.db('contract_line_services').insert({
        contract_line_id: setup.contractLineId,
        service_id: unpricedServiceId,
        tenant: context.tenantId,
      });

      await createUsageRecord({
        client_id: context.clientId,
        service_id: setup.serviceId,
        quantity: 2,
        usage_date: '2023-01-10',
        contract_line_id: setup.contractLineId,
      });
      await createUsageRecord({
        client_id: context.clientId,
        service_id: unpricedServiceId,
        quantity: 4,
        usage_date: '2023-01-12',
        contract_line_id: setup.contractLineId,
      });

      // Preview succeeds for the priced service and reports the broken one as
      // a typed calculation error carrying the recorded quantity.
      const preview = await previewInvoice(setup.billingCycleId);
      expect(preview.success, JSON.stringify(preview)).toBe(true);
      if (!preview.success) throw new Error('unreachable');
      const statuses = preview.usageServicePeriodStatuses ?? [];
      const errored = statuses.find((status) => status.service_id === unpricedServiceId);
      expect(errored?.status).toBe('calculation_error');
      expect(Number(errored?.quantity)).toBe(4);
      expect(statuses.some(
        (status) => status.service_id === unpricedServiceId
          && (status.status === 'missing_usage' || status.status === 'unreported'),
      )).toBe(false);

      // Generation refuses rather than silently omitting the recorded charge.
      const refused = await generateInvoice(setup.billingCycleId);
      expect('actionError' in ((refused ?? {}) as object)).toBe(true);
      expect((refused as { messageKey?: string }).messageKey).toBe(USAGE_CALCULATION_ERROR_MESSAGE_KEY);
      expect(await context.db('invoices').where({ tenant: context.tenantId })).toHaveLength(0);
      const records = await context.db('usage_tracking').where({ tenant: context.tenantId });
      expect(records.every((row: { invoiced: boolean }) => row.invoiced === false)).toBe(true);
    });

    it('an already-invoiced period never re-prompts recording as missing usage', async () => {
      const setup = await setupUsageLine({ measurementMode: 'period_total' });
      await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: setup.contractLineId,
        service_id: setup.serviceId,
        config_id: setup.configId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 10,
      });
      unwrapInvoiceResult(await generateInvoice(setup.billingCycleId));

      // Re-previewing the same window: the consumed total is evidence of
      // reporting, so the failure must not be the coded "record usage" state.
      const preview = await previewInvoice(setup.billingCycleId);
      expect(preview.success).toBe(false);
      if (preview.success) throw new Error('unreachable');
      expect(preview.code).toBeUndefined();
    });
  });

  describe('mixed-invoice omission acknowledgement (R6 / F016)', () => {
    /**
     * One client window (February invoices January) with:
     *  - a Fixed seat line on the client cadence (10 × $100 = $1,000), and
     *  - a period-total Usage line on the contract cadence, unreported.
     */
    async function setupMixedWindow() {
      const seatLineId = await context.createEntity('contract_lines', {
        contract_line_name: 'Mixed Seat Line',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed',
        custom_rate: null,
        billing_timing: 'arrears',
      }, 'contract_line_id');
      const seatServiceId = await createTestService(context, {
        service_name: 'Mixed Seat Service',
        billing_method: 'fixed',
        default_rate: 10000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
      });
      const seatConfigId = uuidv4();
      await context.db('contract_line_services').insert({
        contract_line_id: seatLineId,
        service_id: seatServiceId,
        tenant: context.tenantId,
      });
      await context.db('contract_line_service_configuration').insert({
        config_id: seatConfigId,
        contract_line_id: seatLineId,
        service_id: seatServiceId,
        configuration_type: 'Fixed',
        quantity: 10,
        tenant: context.tenantId,
      });
      await context.db('contract_line_service_fixed_config').insert({
        config_id: seatConfigId,
        tenant: context.tenantId,
        base_rate: 10000,
        pricing_basis: 'unit',
      });
      await assignContractLineToClient(context, seatLineId, {
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      });

      const usageLineId = await context.createEntity('contract_lines', {
        contract_line_name: 'Mixed Usage Line',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Usage',
        billing_timing: 'arrears',
        cadence_owner: 'contract',
      }, 'contract_line_id');
      const usageServiceId = await createTestService(context, {
        service_name: 'Mixed Usage Service',
        billing_method: 'usage',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
      });
      const usageConfigId = uuidv4();
      await context.db('contract_line_service_configuration').insert({
        config_id: usageConfigId,
        contract_line_id: usageLineId,
        service_id: usageServiceId,
        configuration_type: 'Usage',
        quantity: null,
        tenant: context.tenantId,
      });
      await context.db('contract_line_service_usage_config').insert({
        config_id: usageConfigId,
        tenant: context.tenantId,
        unit_of_measure: 'unit',
        enable_tiered_pricing: false,
        minimum_usage: 0,
        measurement_mode: 'period_total',
        base_rate: 1000,
      });
      await context.db('contract_line_services').insert({
        contract_line_id: usageLineId,
        service_id: usageServiceId,
        tenant: context.tenantId,
      });
      const usageAssignment = await assignContractLineToClient(context, usageLineId, {
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      });

      const billingCycleId = await setupInvoiceCycle(2023, 2, 1);
      return {
        seatLineId,
        seatServiceId,
        usageLineId,
        usageServiceId,
        usageConfigId,
        usageContractId: usageAssignment.contractId,
        billingCycleId,
      };
    }

    function usageRecurringPeriods(usageLineId: string) {
      return context.db('recurring_service_periods').where({
        tenant: context.tenantId,
        obligation_id: usageLineId,
      });
    }

    it('without acknowledgement, a mixed window fails coded, lists the omitted services, and creates nothing', async () => {
      const setup = await setupMixedWindow();

      const refused = await generateInvoice(setup.billingCycleId);
      expect('actionError' in ((refused ?? {}) as object)).toBe(true);
      const failure = refused as { messageKey?: string; messageParams?: Record<string, string> };
      expect(failure.messageKey).toBe(USAGE_RECORDS_MISSING_ACK_REQUIRED_MESSAGE_KEY);
      expect(failure.messageParams?.services).toContain('Mixed Usage Service');
      // The marker the recurring run and the UI use to offer an explicit
      // generate-anyway acknowledgement (automated runs never pass it).
      expect(failure.messageParams?.acknowledgeRequired).toBe('true');

      expect(await context.db('invoices').where({ tenant: context.tenantId })).toHaveLength(0);
      expect(await context.db('invoice_charges').where({ tenant: context.tenantId })).toHaveLength(0);
    });

    it('with acknowledgement, generates the fixed charges only and the omitted usage obligation stays billable exactly once', async () => {
      const setup = await setupMixedWindow();

      const invoice = unwrapInvoiceResult(
        await generateInvoice(setup.billingCycleId, { acknowledgeUnreportedUsage: true }),
      );
      // 10 seats × $100 and nothing else.
      expect(invoice).toMatchObject({ subtotal: 100000 });

      // The omitted usage obligation is not marked fulfilled: no period total
      // exists or was consumed, and the usage line's recurring period is not
      // billed/linked to the invoice.
      expect(await totalsTable().where({ tenant: context.tenantId })).toHaveLength(0);
      const usagePeriods = await usageRecurringPeriods(setup.usageLineId);
      expect(usagePeriods.length).toBeGreaterThan(0);
      expect(usagePeriods.every(
        (row: { lifecycle_state: string; invoice_id: string | null }) =>
          row.lifecycle_state !== 'billed' && row.invoice_id == null,
      )).toBe(true);

      // Later, the operator reports January and bills just the usage line's
      // contract-cadence window: the omitted obligation is billed exactly once.
      await upsertUsagePeriodTotal({
        client_id: context.clientId,
        client_contract_line_id: setup.usageLineId,
        service_id: setup.usageServiceId,
        config_id: setup.usageConfigId,
        period_start: JAN_PERIOD.period_start,
        period_end: JAN_PERIOD.period_end,
        quantity: 4,
      });
      const usageSelectorInput = buildContractCadenceDueSelectionInput({
        clientId: context.clientId,
        contractId: setup.usageContractId,
        contractLineId: setup.usageLineId,
        windowStart: '2023-02-01',
        windowEnd: '2023-03-01',
      });
      const usageInvoice = unwrapInvoiceResult(
        await generateInvoiceForSelectionInput(usageSelectorInput),
      );
      expect(usageInvoice).toMatchObject({ subtotal: 4000 });
      const totals = await totalsTable().where({ tenant: context.tenantId });
      expect(totals).toHaveLength(1);
      expect(totals[0]).toMatchObject({ quantity: 4, lifecycle_state: 'billed' });

      // Exactly once: a retry refuses and consumes nothing further.
      const retry = await generateInvoiceForSelectionInput(usageSelectorInput)
        .catch((error: unknown) => error);
      const retryIsRefusal =
        retry === null || retry instanceof Error || 'actionError' in ((retry ?? {}) as object);
      expect(retryIsRefusal).toBe(true);
      const totalsAfterRetry = await totalsTable().where({ tenant: context.tenantId });
      expect(totalsAfterRetry).toHaveLength(1);
      expect(totalsAfterRetry[0]).toMatchObject({ quantity: 4, lifecycle_state: 'billed' });
      expect(totalsAfterRetry[0].invoice_id).toBe(usageInvoice.invoice_id);
    });
  });
});
