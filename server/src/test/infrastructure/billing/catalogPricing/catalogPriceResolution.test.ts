import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  materializeRecurringServicePeriods,
  setLineProvenance,
  updateCatalogPrice,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { previewServicePriceChange } from '@alga-psa/billing/actions/servicePriceRolloutActions';
import { resetContractLineRateToStandard } from '@alga-psa/billing/actions/rateReviewActions';
import { createClient } from '../../../../../test-utils/testDataFactory';
import {
  loadFixedConfigBaseRates,
  loadPricingScheduleRates,
  resolveConfiguredFee,
  resolvePricingScheduleRate,
  type RawBucketPeriodRow,
} from '@alga-psa/reporting/actions/report-actions/deferred-revenue/loaders';

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

  it('T16: the real provenance migration is money-neutral for the same period, per line', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'Backfill Service',
      billing_method: 'fixed',
      default_rate: 10000
    });

    const secondClientId = await createClient(
      context.db,
      context.tenantId,
      'Backfill Second Client',
    );
    await setupClientTaxConfiguration(context, {
      clientId: secondClientId,
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 0
    });

    // One legacy line shape, seeded on two independent clients so the *same*
    // calendar period can be invoiced once before and once after the migration
    // (the engine will not re-bill an already-invoiced period for one client).
    async function seedLegacyLine(clientId: string): Promise<string> {
      const { contractLineId } = await createFixedPlanAssignment(context, serviceId, {
        planName: `Backfill ${clientId.slice(0, 6)}`,
        billingFrequency: 'monthly',
        baseRateCents: 10000,
        quantity: 1,
        startDate: JAN_START,
        billingTiming: 'advance',
        clientId,
      });
      // Legacy pre-migration state: stored rates, no label at either level.
      await context.db('contract_lines')
        .where({ tenant: context.tenantId, contract_line_id: contractLineId })
        .update({ custom_rate: 10000, rate_provenance: null });
      await context.db.raw(
        `UPDATE contract_line_service_fixed_config AS clsfc
         SET base_rate = 10000, rate_provenance = NULL
         FROM contract_line_service_configuration AS clsc
         WHERE clsc.config_id = clsfc.config_id
           AND clsc.tenant = clsfc.tenant
           AND clsc.tenant = ?
           AND clsc.contract_line_id = ?`,
        [context.tenantId, contractLineId],
      );
      await materializeRecurringServicePeriods(context, contractLineId);
      return contractLineId;
    }

    const firstLineId = await seedLegacyLine(context.clientId);
    const secondLineId = await seedLegacyLine(secondClientId);

    async function invoiceJanuary(clientId: string) {
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: JAN_START,
        period_start_date: JAN_START,
        period_end_date: FEB_START
      }, 'billing_cycle_id');
      const result = await generateInvoice(billingCycleId);
      if (!result || !(result as { invoice_id?: string }).invoice_id) {
        throw new Error(`invoice generation failed for ${clientId}: ${JSON.stringify(result)}`);
      }
      return result!;
    }

    async function lineNet(invoiceId: string, contractLineId: string): Promise<number | null> {
      const row = await context.db('invoice_charges as ic')
        .join('invoice_charge_details as iid', function joinDetail() {
          this.on('iid.item_id', '=', 'ic.item_id').andOn('iid.tenant', '=', 'ic.tenant');
        })
        .join('contract_line_service_configuration as clsc', function joinConfig() {
          this.on('clsc.config_id', '=', 'iid.config_id').andOn(
            'clsc.tenant',
            '=',
            'iid.tenant',
          );
        })
        .where('ic.tenant', context.tenantId)
        .where('ic.invoice_id', invoiceId)
        .where('clsc.contract_line_id', contractLineId)
        .first('ic.net_amount');
      return row ? parseInt(row.net_amount) : null;
    }

    // Before the migration: the legacy row bills its stored number.
    const before = await invoiceJanuary(context.clientId);
    const beforeNet = await lineNet(before.invoice_id, firstLineId);
    expect(beforeNet).toBe(10000);

    // Exercise the real migrations, both directions, so the actual backfill SQL
    // runs rather than a hand-written imitation of it.
    const require = createRequire(import.meta.url);
    const provenanceMigrations = [
      require('../../../../../migrations/20260912110000_add_rate_provenance_to_contract_lines.cjs'),
      require('../../../../../migrations/20260912120000_add_rate_provenance_to_service_fixed_config.cjs'),
    ];
    for (const migration of provenanceMigrations) {
      await migration.down(context.db);
    }
    for (const migration of provenanceMigrations) {
      await migration.up(context.db);
    }

    // The backfill classified both legacy lines without touching the rates.
    const backfilledLines = await context.db('contract_lines')
      .whereIn('contract_line_id', [firstLineId, secondLineId])
      .select('contract_line_id', 'custom_rate', 'rate_provenance');
    expect(backfilledLines).toHaveLength(2);
    for (const row of backfilledLines) {
      expect(Number(row.custom_rate)).toBe(10000);
      expect(row.rate_provenance).toBe('unreviewed');
    }
    const backfilledMembers = await context.db('contract_line_service_fixed_config as clsfc')
      .join('contract_line_service_configuration as clsc', function joinConfig() {
        this.on('clsc.config_id', '=', 'clsfc.config_id').andOn(
          'clsc.tenant',
          '=',
          'clsfc.tenant',
        );
      })
      .where('clsc.tenant', context.tenantId)
      .whereIn('clsc.contract_line_id', [firstLineId, secondLineId])
      .select('clsc.contract_line_id', 'clsfc.base_rate', 'clsfc.rate_provenance');
    expect(backfilledMembers).toHaveLength(2);
    for (const row of backfilledMembers) {
      expect(Number(row.base_rate)).toBe(10000);
      expect(row.rate_provenance).toBe('unreviewed');
    }

    // After the migration the same January period bills the same per-line amount.
    const after = await invoiceJanuary(secondClientId);
    const afterNet = await lineNet(after.invoice_id, secondLineId);
    expect(afterNet).toBe(10000);
    expect(afterNet).toBe(beforeNet);
  });

  /**
   * Create a monthly billing cycle and invoice it. The period is
   * `[startDate, endDate)` and the engine reads the catalog rate effective at
   * the period start.
   */
  async function invoiceCycle(startDate: string, endDate: string) {
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: startDate,
      period_start_date: startDate,
      period_end_date: endDate
    }, 'billing_cycle_id');

    const result = await generateInvoice(billingCycleId);
    expect(result).not.toBeNull();
    return result!;
  }

  /**
   * A fixed line whose stored rate is cleared and whose member is linked to the
   * catalog: `inherited`. Returns the service and line ids.
   */
  async function seedInheritedLine(
    serviceName: string,
    rateCents: number,
    startDate: string,
  ) {
    const serviceId = await createTestService(context, {
      service_name: serviceName,
      billing_method: 'fixed',
      default_rate: rateCents
    });
    const { contractLineId, contractId } = await createFixedPlanAssignment(context, serviceId, {
      planName: `${serviceName} plan`,
      billingFrequency: 'monthly',
      baseRateCents: rateCents,
      quantity: 1,
      startDate,
      billingTiming: 'advance'
    });
    await linkMemberToCatalog(contractLineId);
    await setLineProvenance(context, contractLineId, 'inherited');
    await materializeRecurringServicePeriods(context, contractLineId);
    return { serviceId, contractLineId, contractId };
  }

  const JAN_START = createTestDateISO({ year: 2023, month: 1, day: 1 });
  const FEB_START = createTestDateISO({ year: 2023, month: 2, day: 1 });
  const MAR_START = createTestDateISO({ year: 2023, month: 3, day: 1 });

  it('T1: an inherited line follows a catalog price change on the next period', async () => {
    const { serviceId, contractLineId } = await seedInheritedLine('T1 Service', 10000, JAN_START);

    const january = await invoiceCycle(JAN_START, FEB_START);
    expect(january.subtotal).toBe(10000);

    await updateCatalogPrice(context, serviceId, { rateCents: 12000, effectiveDate: FEB_START });
    await materializeRecurringServicePeriods(context, contractLineId);

    const february = await invoiceCycle(FEB_START, MAR_START);
    expect(february.subtotal).toBe(12000);

    const items = await context.db('invoice_charges')
      .where('invoice_id', february.invoice_id)
      .select('*');
    expect(items).toHaveLength(1);
    expect(parseInt(items[0].net_amount)).toBe(12000);
  });

  it('T2: a custom line does not follow a catalog price change', async () => {
    const { serviceId, contractLineId } = await seedInheritedLine('T2 Service', 10000, JAN_START);
    await setLineProvenance(context, contractLineId, 'custom', 10000);

    const january = await invoiceCycle(JAN_START, FEB_START);
    expect(january.subtotal).toBe(10000);

    await updateCatalogPrice(context, serviceId, { rateCents: 12000, effectiveDate: FEB_START });
    await materializeRecurringServicePeriods(context, contractLineId);

    const february = await invoiceCycle(FEB_START, MAR_START);
    expect(february.subtotal).toBe(10000);
  });

  it('T7: an unreviewed line does not follow a catalog price change (legacy safety)', async () => {
    const { serviceId, contractLineId } = await seedInheritedLine('T7 Service', 10000, JAN_START);
    await setLineProvenance(context, contractLineId, 'unreviewed', 10000);

    const january = await invoiceCycle(JAN_START, FEB_START);
    expect(january.subtotal).toBe(10000);

    await updateCatalogPrice(context, serviceId, { rateCents: 12000, effectiveDate: FEB_START });
    await materializeRecurringServicePeriods(context, contractLineId);

    const february = await invoiceCycle(FEB_START, MAR_START);
    expect(february.subtotal).toBe(10000);
  });

  it('T3: a mid-period effective date leaves the current period alone and prices the next', async () => {
    const { serviceId, contractLineId } = await seedInheritedLine('T3 Service', 10000, JAN_START);

    // Effective Jan 15: after the Jan period start, before the Feb period start.
    await updateCatalogPrice(context, serviceId, { rateCents: 12000, effectiveDate: '2023-01-15' });
    await materializeRecurringServicePeriods(context, contractLineId);

    const january = await invoiceCycle(JAN_START, FEB_START);
    expect(january.subtotal).toBe(10000);

    const february = await invoiceCycle(FEB_START, MAR_START);
    expect(february.subtotal).toBe(12000);
  });

  it('T4: an already-invoiced period is untouched and the preview excludes it with a reason', async () => {
    const { serviceId, contractLineId } = await seedInheritedLine('T4 Service', 10000, JAN_START);

    const january = await invoiceCycle(JAN_START, FEB_START);
    expect(january.subtotal).toBe(10000);

    const preview = await previewServicePriceChange(serviceId, 12000, '2023-01-01');
    if (!('willChange' in preview)) {
      throw new Error(`preview failed: ${JSON.stringify(preview)}`);
    }
    expect(preview.willChange).toHaveLength(0);
    const excluded = preview.excluded.find((row) => row.contractLineId === contractLineId);
    expect(excluded).toBeDefined();
    expect(excluded!.reason).toMatch(/invoiced/i);

    // The generated invoice keeps its original amount.
    const items = await context.db('invoice_charges')
      .where('invoice_id', january.invoice_id)
      .select('*');
    expect(parseInt(items[0].net_amount)).toBe(10000);
  });

  it('T4b: the already-invoiced guard survives without the recurring-period signal', async () => {
    const { serviceId, contractLineId } = await seedInheritedLine('T4b Service', 10000, JAN_START);
    await invoiceCycle(JAN_START, FEB_START);

    // The pre-materialization shape: charges exist but the recurring-period
    // rows are absent, so only invoice_charge_details / the client cycle can
    // report the period as billed.
    await context.db('recurring_service_periods')
      .where({ tenant: context.tenantId })
      .del();

    const preview = await previewServicePriceChange(serviceId, 12000, '2023-01-01');
    if (!('willChange' in preview)) {
      throw new Error(`preview failed: ${JSON.stringify(preview)}`);
    }
    expect(preview.willChange).toHaveLength(0);
    const excluded = preview.excluded.find((row) => row.contractLineId === contractLineId);
    expect(excluded).toBeDefined();
    expect(excluded!.reason).toMatch(/invoiced/i);
  });

  it('T5: reset-to-standard clears the member snapshot and re-links the line to the catalog', async () => {
    const { serviceId, contractLineId } = await seedInheritedLine('T5 Service', 10000, JAN_START);
    await setLineProvenance(context, contractLineId, 'custom', 4500);

    // A wizard-built line snapshots the rate into the member config. Reset must
    // clear that too, or the member keeps shadowing the catalog after the line
    // is cleared and the line reports Standard while billing the old number.
    await context.db.raw(
      `UPDATE contract_line_service_fixed_config AS clsfc
       SET base_rate = 4500, rate_provenance = 'custom'
       FROM contract_line_service_configuration AS clsc
       WHERE clsc.config_id = clsfc.config_id
         AND clsc.tenant = clsfc.tenant
         AND clsc.tenant = ?
         AND clsc.contract_line_id = ?`,
      [context.tenantId, contractLineId],
    );

    const january = await invoiceCycle(JAN_START, FEB_START);
    expect(january.subtotal).toBe(4500);

    const reset = await resetContractLineRateToStandard(contractLineId);
    if (!('applied' in reset)) {
      throw new Error(`reset failed: ${JSON.stringify(reset)}`);
    }
    if (reset.applied.length === 0) {
      throw new Error(`reset refused: ${JSON.stringify(reset.refused)}`);
    }
    expect(reset.applied).toHaveLength(1);

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate', 'rate_provenance');
    expect(line.custom_rate).toBeNull();
    expect(line.rate_provenance).toBe('inherited');

    const memberResult = await context.db.raw(
      `SELECT clsfc.base_rate, clsfc.rate_provenance
       FROM contract_line_service_fixed_config AS clsfc
       JOIN contract_line_service_configuration AS clsc
         ON clsc.config_id = clsfc.config_id AND clsc.tenant = clsfc.tenant
       WHERE clsc.tenant = ? AND clsc.contract_line_id = ?`,
      [context.tenantId, contractLineId],
    );
    expect(memberResult.rows[0].base_rate).toBeNull();
    expect(memberResult.rows[0].rate_provenance).toBe('inherited');

    await materializeRecurringServicePeriods(context, contractLineId);
    const february = await invoiceCycle(FEB_START, MAR_START);
    expect(february.subtotal).toBe(10000);
  });

  it('T5b: reset-to-standard refuses a line whose members resolve to no catalog rate', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'T5b Service',
      billing_method: 'fixed',
      default_rate: 10000,
      seedServicePrice: false,
    });
    const { contractLineId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'T5b Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      quantity: 1,
      startDate: JAN_START,
      billingTiming: 'advance',
    });
    await linkMemberToCatalog(contractLineId);
    // Remove the legacy catalog rate too, so no member resolves to a number.
    await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: serviceId })
      .update({ default_rate: null });
    await setLineProvenance(context, contractLineId, 'custom', 4500);

    const reset = await resetContractLineRateToStandard(contractLineId);
    if (!('refused' in reset)) {
      throw new Error(`reset unexpectedly applied: ${JSON.stringify(reset)}`);
    }
    expect(reset.applied).toHaveLength(0);
    expect(reset.refused).toHaveLength(1);
    expect(reset.refused[0].reason).toMatch(/no catalog rate/i);

    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate', 'rate_provenance');
    expect(Number(line.custom_rate)).toBe(4500);
    expect(line.rate_provenance).toBe('custom');
  });

  async function assertReportAgreesWithInvoice(
    provenance: 'inherited' | 'custom' | 'unreviewed',
    withSchedule: boolean,
  ) {
    // Correction #1: the engine does read contract_pricing_schedules. When a
    // schedule is active it wins for every provenance; the report's own loader
    // and precedence chain must land on the same number.
    const { serviceId, contractLineId, contractId } = await seedInheritedLine(
      `T6 ${provenance} ${withSchedule ? 'schedule' : 'plain'}`,
      10000,
      JAN_START,
    );
    if (provenance !== 'inherited') {
      await setLineProvenance(context, contractLineId, provenance, provenance === 'custom' ? 4500 : 10000);
    }

    const scheduleRateCents = 20000;
    if (withSchedule) {
      await context.db('contract_pricing_schedules').insert({
        schedule_id: uuidv4(),
        contract_id: contractId,
        tenant: context.tenantId,
        effective_date: JAN_START,
        end_date: null,
        custom_rate: scheduleRateCents,
        notes: `T6 ${provenance} schedule`
      });
      await materializeRecurringServicePeriods(context, contractLineId);
    }

    const january = await invoiceCycle(JAN_START, FEB_START);

    const schedules = await loadPricingScheduleRates(context.db, context.tenantId, [contractId]);
    const scheduleRate = resolvePricingScheduleRate(
      JAN_START,
      '2023-01-31',
      contractId,
      schedules,
      contractLineId,
    );
    const baseRates = await loadFixedConfigBaseRates(context.db, context.tenantId);
    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate');
    const periodRow: RawBucketPeriodRow = {
      usageId: `t6-${provenance}-${withSchedule}`,
      contractLineId,
      contractId,
      contractLineName: `T6 ${provenance}`,
      clientId: context.clientId,
      serviceId,
      serviceName: `T6 ${provenance}`,
      periodStart: JAN_START,
      periodEnd: '2023-01-31',
      minutesUsed: 0,
      rolledOverMinutes: 0,
      totalMinutes: 0,
      allowRollover: false,
      currencyCode: 'USD',
      lineCustomRate: line?.custom_rate != null ? Number(line.custom_rate) : null,
      catalogDefaultRate: 10000,
    };
    const configured = resolveConfiguredFee(
      periodRow,
      baseRates.get(`${contractLineId}\u0000${serviceId}`) ?? null,
      scheduleRate,
    );
    expect(configured).toBe(january.subtotal);
  }

  it('T6 (inherited): an active pricing schedule reaches the invoice and the report agrees', async () => {
    await assertReportAgreesWithInvoice('inherited', true);
  });

  it('T6 (custom): an active pricing schedule reaches the invoice and the report agrees', async () => {
    await assertReportAgreesWithInvoice('custom', true);
  });

  it('T6 (unreviewed): an active pricing schedule reaches the invoice and the report agrees', async () => {
    await assertReportAgreesWithInvoice('unreviewed', true);
  });

  it('T6b (inherited): with no schedule, inherited follows the catalog and the report agrees', async () => {
    await assertReportAgreesWithInvoice('inherited', false);
  });

  it('T6b (custom): with no schedule, custom keeps its rate and the report agrees', async () => {
    await assertReportAgreesWithInvoice('custom', false);
  });

  it('T21: a null-rate newest schedule blocks older schedules in billing and the report', async () => {
    const { serviceId, contractLineId, contractId } = await seedInheritedLine(
      'T21 Service',
      10000,
      JAN_START,
    );

    // Two non-overlapping rows (the DB EXCLUDE backstop forbids overlapping
    // ones): an older bounded override, then a newer null-rate row. The newest
    // active schedule is the null one and the engine checks its rate *after*
    // choosing it, so the older 20000 must not resurface — and the deferred
    // revenue report must land on the same number (plan §2.3, test T21).
    await context.db('contract_pricing_schedules').insert([
      {
        schedule_id: uuidv4(),
        contract_id: contractId,
        tenant: context.tenantId,
        effective_date: '2022-12-01',
        end_date: '2023-01-15',
        custom_rate: 20000,
        notes: 'T21 older override',
      },
      {
        schedule_id: uuidv4(),
        contract_id: contractId,
        tenant: context.tenantId,
        effective_date: '2023-01-15',
        end_date: null,
        custom_rate: null,
        notes: 'T21 newest null',
      },
    ]);
    await materializeRecurringServicePeriods(context, contractLineId);

    const january = await invoiceCycle(JAN_START, FEB_START);
    expect(january.subtotal).toBe(10000);

    const schedules = await loadPricingScheduleRates(context.db, context.tenantId, [contractId]);
    const scheduleRate = resolvePricingScheduleRate(
      JAN_START,
      '2023-01-31',
      contractId,
      schedules,
      contractLineId,
    );
    expect(scheduleRate).toBeNull();

    const baseRates = await loadFixedConfigBaseRates(context.db, context.tenantId);
    const line = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_line_id: contractLineId })
      .first('custom_rate');
    const periodRow: RawBucketPeriodRow = {
      usageId: 't21',
      contractLineId,
      contractId,
      contractLineName: 'T21',
      clientId: context.clientId,
      serviceId,
      serviceName: 'T21 Service',
      periodStart: JAN_START,
      periodEnd: '2023-01-31',
      minutesUsed: 0,
      rolledOverMinutes: 0,
      totalMinutes: 0,
      allowRollover: false,
      currencyCode: 'USD',
      lineCustomRate: line?.custom_rate != null ? Number(line.custom_rate) : null,
      catalogDefaultRate: 10000,
    };
    const configured = resolveConfiguredFee(
      periodRow,
      baseRates.get(`${contractLineId}\u0000${serviceId}`) ?? null,
      scheduleRate,
    );
    expect(configured).toBe(january.subtotal);
  });

  it('parity: the rate the rollout preview shows equals the rate the engine bills on the next invoice', async () => {
    // Item 3b. The rollout preview prices a line with `resolveFixedLineRate`;
    // the invoice prices it through the billing engine's inline chain. Neither
    // calls the other, so this is the test that catches them drifting apart.
    // For each line shape: read the rate the preview shows for the *next*
    // period, write the catalog change it described, then assert the engine
    // charges exactly that number for the same line on the next invoice.
    async function lineNetAmount(
      invoiceId: string,
      contractLineId: string,
    ): Promise<number | null> {
      const row = await context.db('invoice_charges as ic')
        .join('invoice_charge_details as iid', function joinDetail() {
          this.on('iid.item_id', '=', 'ic.item_id').andOn(
            'iid.tenant',
            '=',
            'ic.tenant',
          );
        })
        .join('contract_line_service_configuration as clsc', function joinConfig() {
          this.on('clsc.config_id', '=', 'iid.config_id').andOn(
            'clsc.tenant',
            '=',
            'iid.tenant',
          );
        })
        .where('ic.tenant', context.tenantId)
        .where('ic.invoice_id', invoiceId)
        .where('clsc.contract_line_id', contractLineId)
        .first('ic.net_amount');
      return row ? parseInt(row.net_amount) : null;
    }

    // Every shape needs its own client: the engine will not re-bill the same
    // period for a client that already has an invoice for it.
    const shapes: Array<{
      name: string;
      provenance: 'inherited' | 'custom' | 'unreviewed';
      storedRateCents?: number;
      scheduleRateCents?: number;
      /** Unit-priced member: quantity > 1, priced from the catalog per seat. */
      quantity?: number;
      unitPriced?: boolean;
    }> = [
      { name: 'inherited follows the catalog', provenance: 'inherited' },
      { name: 'custom keeps its stored rate', provenance: 'custom', storedRateCents: 10000 },
      { name: 'unreviewed keeps its stored rate', provenance: 'unreviewed', storedRateCents: 10000 },
      { name: 'active schedule wins over the catalog', provenance: 'inherited', scheduleRateCents: 20000 },
      { name: 'unit-priced seats derive from the catalog', provenance: 'inherited', quantity: 3, unitPriced: true },
    ];

    const NEW_RATE = 12000;
    // `previewServicePriceChange` takes a calendar date (`YYYY-MM-DD`): the
    // fixture's `createTestDateISO` returns a full instant string.
    const FEB_PERIOD = FEB_START.slice(0, 10);

    for (const shape of shapes) {
      const clientId = await createClient(
        context.db,
        context.tenantId,
        `Parity ${shape.name}`,
      );
      await setupClientTaxConfiguration(context, {
        clientId,
        regionCode: 'US-NY',
        regionName: 'New York',
        description: 'NY State Tax',
        startDate: '2020-01-01T00:00:00.000Z',
        taxPercentage: 0,
      });

      const serviceId = await createTestService(context, {
        service_name: `Parity ${shape.name}`,
        billing_method: 'fixed',
        default_rate: 10000,
      });
      const { contractLineId, contractId } = await createFixedPlanAssignment(
        context,
        serviceId,
        {
          planName: `Parity ${shape.name} plan`,
          billingFrequency: 'monthly',
          baseRateCents: 10000,
          quantity: shape.quantity ?? 1,
          startDate: JAN_START,
          billingTiming: 'advance',
          clientId,
        },
      );
      await linkMemberToCatalog(contractLineId);
      if (shape.unitPriced) {
        // `linkMemberToCatalog` only clears the snapshot; mark the member
        // unit-priced so the engine bills quantity × rate instead of a bundle.
        await context.db.raw(
          `UPDATE contract_line_service_fixed_config AS clsfc
           SET pricing_basis = 'unit'
           FROM contract_line_service_configuration AS clsc
           WHERE clsc.config_id = clsfc.config_id
             AND clsc.tenant = clsfc.tenant
             AND clsc.tenant = ?
             AND clsc.contract_line_id = ?`,
          [context.tenantId, contractLineId],
        );
      }
      if (shape.provenance === 'inherited') {
        // `createFixedPlanAssignment` writes the fixture rate into
        // `contract_lines.custom_rate`; an inherited line must have none, or it
        // is really an unreviewed line and this shape proves nothing.
        await setLineProvenance(context, contractLineId, 'inherited');
      } else {
        await setLineProvenance(
          context,
          contractLineId,
          shape.provenance,
          shape.storedRateCents,
        );
      }
      if (shape.scheduleRateCents !== undefined) {
        await context.db('contract_pricing_schedules').insert({
          schedule_id: uuidv4(),
          contract_id: contractId,
          tenant: context.tenantId,
          effective_date: JAN_START,
          end_date: null,
          custom_rate: shape.scheduleRateCents,
          notes: `Parity ${shape.name}`,
        });
      }
      await materializeRecurringServicePeriods(context, contractLineId);

      const preview = await previewServicePriceChange(
        serviceId,
        NEW_RATE,
        FEB_PERIOD,
      );
      if (!('willChange' in preview)) {
        throw new Error(`preview failed for ${shape.name}: ${JSON.stringify(preview)}`);
      }
      const previewRow = [
        ...preview.willChange,
        ...preview.custom,
        ...preview.unreviewed,
      ].find((row) => row.contractLineId === contractLineId);
      expect(previewRow, `no preview row for ${shape.name}`).toBeDefined();

      // Write exactly the catalog change the preview described, then bill it.
      await updateCatalogPrice(context, serviceId, {
        rateCents: NEW_RATE,
        effectiveDate: FEB_PERIOD,
      });
      await materializeRecurringServicePeriods(context, contractLineId);

      const billingCycleId = await context.createEntity(
        'client_billing_cycles',
        {
          client_id: clientId,
          billing_cycle: 'monthly',
          effective_date: FEB_START,
          period_start_date: FEB_START,
          period_end_date: MAR_START,
        },
        'billing_cycle_id',
      );
      const february = await generateInvoice(billingCycleId);
      if (!february) {
        throw new Error(`invoice generation failed for ${shape.name}`);
      }

      const billed = await lineNetAmount(february.invoice_id, contractLineId);
      expect(
        billed,
        `${shape.name}: preview showed ${previewRow!.newRateCents} but the engine billed ${billed}`,
      ).toBe(previewRow!.newRateCents);
      expect(february.subtotal, `${shape.name}: invoice subtotal`).toBe(billed);
    }
  }, 120000);
});
