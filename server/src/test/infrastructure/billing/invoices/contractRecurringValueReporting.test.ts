/**
 * Canonical recurring-value valuation (plan: contract-quantity-and-usage-semantics,
 * R7 / F018–F020, scenario T011).
 *
 * DB-backed proof that the shared valuation used by contract reports and the
 * report summary:
 *  - values explicitly unit-priced Fixed lines as Σ quantity × unit rate
 *    (the 10/9/1 seat example totals 189000 minor units);
 *  - honors the latest unit-pricing revision effective at/before the as-of
 *    date, ignores future-dated (scheduled) revisions, and supersedes earlier
 *    revisions;
 *  - keeps bundle Fixed lines on their line-level rate;
 *  - normalizes non-monthly cadences to a monthly value;
 *  - flags Usage lines as variable revenue instead of valuing them as zero;
 *  - aggregates currencies separately, never summing CAD and USD minor units.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { assignContractLineToClient, createTestService } from '../../../../../test-utils/billingTestHelpers';
import {
  aggregateCentsByCurrency,
  getContractMonthlyValuesByAssignment,
  normalizeToMonthlyCents,
} from '@alga-psa/shared/billingClients/contractMonthlyValue';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Canonical recurring-value valuation (R7 / T011)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'contract_line_unit_pricing_revisions',
        'client_contracts',
        'contract_line_service_fixed_config',
        'contract_line_service_usage_config',
        'contract_line_service_configuration',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'contracts'
      ],
      clientName: 'Recurring Value Reporting Client',
      userType: 'internal'
    });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
  }, 60000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  interface SeatSpec {
    name: string;
    quantity: number | null;
    unitRateCents: number;
  }

  async function createUnitPricedFixedLine(seats: SeatSpec[], options: {
    billingFrequency?: string;
  } = {}): Promise<{ contractLineId: string; members: Array<{ serviceId: string; configId: string }> }> {
    const contractLineId = await context.createEntity('contract_lines', {
      contract_line_name: 'Recurring Seats',
      billing_frequency: options.billingFrequency ?? 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed'
    }, 'contract_line_id');

    const members: Array<{ serviceId: string; configId: string }> = [];
    for (const seat of seats) {
      const serviceId = await createTestService(context, {
        service_name: seat.name,
        billing_method: 'fixed',
        default_rate: seat.unitRateCents,
        unit_of_measure: 'seat'
      });

      const configId = uuidv4();
      await context.db('contract_line_service_configuration').insert({
        config_id: configId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        configuration_type: 'Fixed',
        quantity: seat.quantity,
        tenant: context.tenantId
      });
      await context.db('contract_line_service_fixed_config').insert({
        config_id: configId,
        tenant: context.tenantId,
        base_rate: seat.unitRateCents,
        pricing_basis: 'unit'
      });
      members.push({ serviceId, configId });
    }

    return { contractLineId, members };
  }

  async function createBundleFixedLine(customRateCents: number, options: {
    billingFrequency?: string;
  } = {}): Promise<string> {
    return context.createEntity('contract_lines', {
      contract_line_name: 'Fixed Bundle',
      billing_frequency: options.billingFrequency ?? 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed',
      custom_rate: customRateCents
    }, 'contract_line_id');
  }

  async function createUsageLine(): Promise<string> {
    const serviceId = await createTestService(context, {
      service_name: 'Metered Usage',
      billing_method: 'usage',
      default_rate: 1000,
      unit_of_measure: 'unit'
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
    return contractLineId;
  }

  async function setContractCurrency(contractId: string, currencyCode: string) {
    await context.db('contracts')
      .where({ tenant: context.tenantId, contract_id: contractId })
      .update({ currency_code: currencyCode });
  }

  it('catalog fallback, mixed service bases and Usage configurations on Fixed lines match their billing semantics', async () => {
    const {contractLineId, members} = await createUnitPricedFixedLine([
      {name: 'Catalog-priced seats', quantity: 2, unitRateCents: 1500},
      {name: 'Legacy bundle allocation', quantity: 4, unitRateCents: 500},
    ]);
    await context.db('contract_line_service_fixed_config').where({tenant: context.tenantId, config_id: members[0].configId}).update({base_rate: null});
    await context.db('contract_line_service_fixed_config').where({tenant: context.tenantId, config_id: members[1].configId}).update({pricing_basis: null});
    await context.db('contract_lines').where({tenant: context.tenantId, contract_line_id: contractLineId}).update({custom_rate: 9000});
    const usageService = await createTestService(context, {service_name: 'Variable storage', billing_method: 'usage', default_rate: 500});
    await context.db('contract_line_service_configuration').insert({tenant: context.tenantId, config_id: uuidv4(), contract_line_id: contractLineId,
      service_id: usageService, configuration_type: 'Usage', quantity: 999});
    const {clientContractId} = await assignContractLineToClient(context, contractLineId, {startDate: '2023-01-01'});
    const values = await getContractMonthlyValuesByAssignment(context.db, context.tenantId, [clientContractId], '2023-01-15');
    expect(values.get(clientContractId)).toMatchObject({monthlyValueCents: 12000, hasVariableUsage: true});
  });

  it('values the 10/9/1 recurring-seat example at 189000 minor units with no usage rows', async () => {
    const { contractLineId } = await createUnitPricedFixedLine([
      { name: 'Standard Seat', quantity: 10, unitRateCents: 10000 },
      { name: 'Basic Seat', quantity: 9, unitRateCents: 8500 },
      { name: 'Server', quantity: 1, unitRateCents: 12500 },
    ]);
    const { clientContractId } = await assignContractLineToClient(context, contractLineId, {
      startDate: '2023-01-01'
    });

    const values = await getContractMonthlyValuesByAssignment(
      context.db, context.tenantId, [clientContractId], '2023-01-15'
    );

    const value = values.get(clientContractId);
    expect(value).toBeDefined();
    expect(value!.monthlyValueCents).toBe(189000);
    expect(value!.hasVariableUsage).toBe(false);
  });

  it('applies the latest effective unit-pricing revision, excludes future ones, and supersedes older ones', async () => {
    const { contractLineId, members } = await createUnitPricedFixedLine([
      { name: 'Standard Seat', quantity: 10, unitRateCents: 10000 },
      { name: 'Basic Seat', quantity: 9, unitRateCents: 8500 },
      { name: 'Server', quantity: 1, unitRateCents: 12500 },
    ]);
    const { clientContractId } = await assignContractLineToClient(context, contractLineId, {
      startDate: '2023-01-01'
    });

    const [standardSeat] = members;
    // Superseded: 11 seats effective January…
    await context.db('contract_line_unit_pricing_revisions').insert({
      tenant: context.tenantId,
      contract_line_id: contractLineId,
      service_id: standardSeat.serviceId,
      config_id: standardSeat.configId,
      quantity: 11,
      unit_rate_cents: 10000,
      effective_period_start: '2023-01-01'
    });
    // …superseding revision: 12 seats effective February…
    await context.db('contract_line_unit_pricing_revisions').insert({
      tenant: context.tenantId,
      contract_line_id: contractLineId,
      service_id: standardSeat.serviceId,
      config_id: standardSeat.configId,
      quantity: 12,
      unit_rate_cents: 10000,
      effective_period_start: '2023-02-01'
    });
    // …and a scheduled future change that must not count yet.
    await context.db('contract_line_unit_pricing_revisions').insert({
      tenant: context.tenantId,
      contract_line_id: contractLineId,
      service_id: standardSeat.serviceId,
      config_id: standardSeat.configId,
      quantity: 20,
      unit_rate_cents: 10000,
      effective_period_start: '2023-06-01'
    });

    const februaryValues = await getContractMonthlyValuesByAssignment(
      context.db, context.tenantId, [clientContractId], '2023-02-15'
    );
    // 12 × 10000 + 9 × 8500 + 1 × 12500
    expect(februaryValues.get(clientContractId)!.monthlyValueCents).toBe(209000);

    // Before any revision took effect the configured quantities hold — the
    // 2023-01-01 revision applies within January, the Feb/Jun ones do not.
    const januaryValues = await getContractMonthlyValuesByAssignment(
      context.db, context.tenantId, [clientContractId], '2023-01-15'
    );
    // 11 × 10000 + 9 × 8500 + 1 × 12500
    expect(januaryValues.get(clientContractId)!.monthlyValueCents).toBe(199000);
  });

  it('keeps bundle Fixed lines on their line rate, normalizes cadence, and flags usage as variable', async () => {
    // Quarterly bundle: 30000 per quarter is 10000 per month.
    const bundleLineId = await createBundleFixedLine(30000, { billingFrequency: 'quarterly' });
    const usageLineId = await createUsageLine();
    const contractId = uuidv4();
    const { clientContractId } = await assignContractLineToClient(context, bundleLineId, {
      contractId,
      startDate: '2023-01-01'
    });
    await assignContractLineToClient(context, usageLineId, {
      contractId,
      clientContractId,
      startDate: '2023-01-01'
    });

    const values = await getContractMonthlyValuesByAssignment(
      context.db, context.tenantId, [clientContractId], '2023-01-15'
    );
    const value = values.get(clientContractId)!;
    expect(value.monthlyValueCents).toBe(normalizeToMonthlyCents(30000, 'quarterly'));
    expect(value.monthlyValueCents).toBe(10000);
    // The usage line is flagged as variable revenue, not valued at zero.
    expect(value.hasVariableUsage).toBe(true);
  });

  it('treats a zero seat quantity as zero, never one', async () => {
    const { contractLineId } = await createUnitPricedFixedLine([
      { name: 'Standard Seat', quantity: 0, unitRateCents: 10000 },
      { name: 'Server', quantity: 1, unitRateCents: 12500 },
    ]);
    const { clientContractId } = await assignContractLineToClient(context, contractLineId, {
      startDate: '2023-01-01'
    });

    const values = await getContractMonthlyValuesByAssignment(
      context.db, context.tenantId, [clientContractId], '2023-01-15'
    );
    expect(values.get(clientContractId)!.monthlyValueCents).toBe(12500);
  });

  it('aggregates CAD and USD assignments separately without a cross-currency sum', async () => {
    const { contractLineId: cadLine } = await createUnitPricedFixedLine([
      { name: 'CAD Seat', quantity: 10, unitRateCents: 10000 },
    ]);
    const cadContractId = uuidv4();
    const { clientContractId: cadAssignment } = await assignContractLineToClient(context, cadLine, {
      contractId: cadContractId,
      startDate: '2023-01-01'
    });
    await setContractCurrency(cadContractId, 'CAD');

    const usdBundle = await createBundleFixedLine(25000);
    const { clientContractId: usdAssignment } = await assignContractLineToClient(context, usdBundle, {
      startDate: '2023-01-01'
    });

    const values = await getContractMonthlyValuesByAssignment(
      context.db, context.tenantId, [cadAssignment, usdAssignment], '2023-01-15'
    );
    expect(values.get(cadAssignment)!.currencyCode).toBe('CAD');
    expect(values.get(usdAssignment)!.currencyCode).toBe('USD');

    const aggregated = aggregateCentsByCurrency(
      Array.from(values.values()).map((value) => ({
        currencyCode: value.currencyCode,
        amountCents: value.monthlyValueCents,
      })),
    );
    expect(aggregated).toEqual([
      { currencyCode: 'CAD', totalCents: 100000 },
      { currencyCode: 'USD', totalCents: 25000 },
    ]);
  });
});
