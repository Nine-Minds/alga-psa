import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingEngine } from '@alga-psa/billing/services';
import { TaxService } from '@alga-psa/billing/services/taxService';

const billingEngineSource = readFileSync(
  new URL('../../../../../packages/billing/src/lib/billing/billingEngine.ts', import.meta.url),
  'utf8',
);

const PERIOD = {
  startDate: '2026-07-01',
  endDate: '2026-08-01',
};

const CLIENT = {
  client_id: 'client-1',
  client_name: 'Acme',
  default_currency_code: 'USD',
  is_tax_exempt: false,
};

function config(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-1',
    config_id: 'config-1',
    project_id: 'project-1',
    billing_model: 'fixed_price',
    total_price: 10_000,
    currency: 'USD',
    invoice_mode: 'recurring',
    contract_id: null,
    cap_amount: null,
    cap_behavior: null,
    cap_notify_thresholds: [50, 75, 100],
    deposit_treatment: 'credit',
    is_taxable: false,
    tax_region: 'US-NY',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    project_name: 'Implementation',
    project_number: 'PRJ-100',
    ...overrides,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-1',
    schedule_entry_id: 'entry-1',
    config_id: 'config-1',
    entry_type: 'milestone',
    description: 'Discovery complete',
    amount: 5_000,
    percentage: null,
    trigger_type: 'manual',
    phase_id: null,
    trigger_date: null,
    status: 'approved',
    ready_at: '2026-07-01T00:00:00.000Z',
    approved_by: 'user-1',
    approved_at: '2026-07-02T00:00:00.000Z',
    invoice_id: null,
    invoice_charge_id: null,
    display_order: 0,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

function context(configs: any[], entries: any[], amounts?: Map<string, number>) {
  return {
    configs,
    configsById: new Map(configs.map((candidate) => [candidate.config_id, candidate])),
    configsByProjectId: new Map(configs.map((candidate) => [candidate.project_id, candidate])),
    entriesByConfigId: new Map(configs.map((candidate) => [
      candidate.config_id,
      entries.filter((candidateEntry) => candidateEntry.config_id === candidate.config_id),
    ])),
    computedAmountsByEntryId: amounts ?? new Map(entries.map((candidate) => [
      candidate.schedule_entry_id,
      candidate.amount ?? 0,
    ])),
    phaseNamesByEntryId: new Map(entries.map((candidate) => [candidate.schedule_entry_id, null])),
    overridesByPhaseId: new Map(),
    capUsageByConfigId: new Map(),
  };
}

function identityAdjustments(engine: BillingEngine) {
  vi.spyOn(engine as any, 'applyDiscountsAndAdjustments').mockImplementation(async (result: any) => ({
    ...result,
    finalAmount: result.totalAmount,
  }));
}

describe('project schedule charge selection', () => {
  let engine: BillingEngine;

  beforeEach(() => {
    engine = new BillingEngine();
    vi.restoreAllMocks();
  });

  it('T011: recurring runs pick up only approved recurring milestones for the client', async () => {
    const recurring = config();
    const standalone = config({
      config_id: 'config-2',
      project_id: 'project-2',
      invoice_mode: 'standalone',
      project_name: 'Standalone project',
    });
    const entries = [
      entry(),
      entry({ schedule_entry_id: 'entry-ready', status: 'ready', amount: 2_000 }),
      entry({
        schedule_entry_id: 'entry-standalone',
        config_id: 'config-2',
        status: 'approved',
        amount: 7_000,
      }),
    ];
    const billingContext = context([recurring, standalone], entries);

    const charges = await (engine as any).calculateProjectMilestoneCharges(
      billingContext,
      CLIENT,
      PERIOD,
      'USD',
    );

    expect(charges).toEqual([expect.objectContaining({
      type: 'project_milestone',
      project_id: 'project-1',
      schedule_entry_id: 'entry-1',
      serviceName: 'Discovery complete',
      rate: 5_000,
      total: 5_000,
    })]);
  });

  it('T012: a standalone target contains only approved selected entries from that project', async () => {
    const target = config({ invoice_mode: 'standalone' });
    const other = config({
      config_id: 'config-2',
      project_id: 'project-2',
      invoice_mode: 'standalone',
    });
    const entries = [
      entry(),
      entry({ schedule_entry_id: 'entry-2', amount: 3_000, description: 'Selected milestone' }),
      entry({ schedule_entry_id: 'entry-other', config_id: 'config-2', amount: 9_000 }),
      entry({ schedule_entry_id: 'entry-pending', status: 'pending', amount: 1_000 }),
    ];

    const charges = await (engine as any).calculateProjectMilestoneCharges(
      context([target, other], entries),
      CLIENT,
      PERIOD,
      'USD',
      { projectId: 'project-1', entryIds: ['entry-2', 'entry-other', 'entry-pending'] },
    );

    expect(charges.map((charge: any) => charge.schedule_entry_id)).toEqual(['entry-2']);
  });

  it('T020: deduct_final reduces only the final milestone by prior invoiced deposits', async () => {
    const projectConfig = config({ deposit_treatment: 'deduct_final' });
    const entries = [
      entry({ schedule_entry_id: 'deposit-1', entry_type: 'deposit', status: 'invoiced', amount: 2_000 }),
      entry({ schedule_entry_id: 'milestone-1', amount: 3_000, display_order: 1 }),
      entry({ schedule_entry_id: 'milestone-final', amount: 5_000, display_order: 2 }),
    ];

    const charges = await (engine as any).calculateProjectMilestoneCharges(
      context([projectConfig], entries),
      CLIENT,
      PERIOD,
      'USD',
    );

    expect(charges.map((charge: any) => [charge.schedule_entry_id, charge.total])).toEqual([
      ['milestone-1', 3_000],
      ['milestone-final', 3_000],
    ]);
  });

  it('T022: taxable milestone charges use TaxService and non-taxable configs do not', async () => {
    const taxSpy = vi.spyOn(TaxService.prototype, 'calculateTax').mockImplementation(async (
      _clientId,
      amount,
    ) => ({ taxAmount: Math.ceil((amount * 8.25) / 100), taxRate: 8.25 }));
    const taxableContext = context([config({ is_taxable: true })], [
      entry({ schedule_entry_id: 'taxable-1', amount: 6_000, display_order: 0 }),
      entry({ schedule_entry_id: 'taxable-2', amount: 4_000, display_order: 1 }),
    ]);

    const taxable = await (engine as any).calculateProjectMilestoneCharges(
      taxableContext,
      CLIENT,
      PERIOD,
      'USD',
    );
    expect(taxable).toEqual([
      expect.objectContaining({ schedule_entry_id: 'taxable-1', tax_amount: 495, tax_rate: 8.25, tax_region: 'US-NY' }),
      expect.objectContaining({ schedule_entry_id: 'taxable-2', tax_amount: 330, tax_rate: 8.25, tax_region: 'US-NY' }),
    ]);
    expect(taxable.reduce((sum: number, charge: any) => sum + charge.tax_amount, 0)).toBe(825);
    expect(taxSpy).toHaveBeenNthCalledWith(1, 'client-1', 6_000, PERIOD.endDate, 'US-NY', true, 'USD');
    expect(taxSpy).toHaveBeenNthCalledWith(2, 'client-1', 4_000, PERIOD.endDate, 'US-NY', true, 'USD');

    taxSpy.mockClear();
    const nonTaxable = await (engine as any).calculateProjectMilestoneCharges(
      context([config({ is_taxable: false })], [entry({ amount: 10_000 })]),
      CLIENT,
      PERIOD,
      'USD',
    );
    expect(nonTaxable[0]).toMatchObject({ tax_amount: 0, tax_rate: 0, is_taxable: false });
    expect(taxSpy).not.toHaveBeenCalled();
  });
});

describe('project T&M cap and override integration', () => {
  let engine: BillingEngine;

  beforeEach(() => {
    engine = new BillingEngine();
  });

  it('T015: exact-service overrides win over phase-wide overrides and preserve replacement service metadata', () => {
    const exact = {
      rate_override_id: 'override-exact',
      phase_id: 'phase-1',
      service_id: 'service-1',
      rate: 20_000,
      override_service_id: 'service-replacement',
      override_service_name: 'Architecture',
      override_tax_rate_id: 'tax-1',
      override_default_rate: 15_000,
    };
    const phaseWide = {
      ...exact,
      rate_override_id: 'override-wide',
      service_id: null,
      rate: 12_000,
      override_service_id: null,
    };
    const billingContext = context([config({ billing_model: 'time_and_materials' })], []);
    billingContext.overridesByPhaseId.set('phase-1', [phaseWide, exact]);

    expect((engine as any).resolveProjectPhaseRateOverride(
      billingContext,
      'phase-1',
      'service-1',
    )).toBe(exact);
    expect((engine as any).resolveProjectPhaseRateOverride(
      billingContext,
      'phase-1',
      'service-2',
    )).toBe(phaseWide);
    expect((engine as any).resolveProjectPhaseRateOverride(
      billingContext,
      'phase-2',
      'service-1',
    )).toBeNull();
    expect(billingEngineSource).toContain('phaseOverride?.rate ?? (Number(resolvedRate) || 0)');
    expect(billingEngineSource).toContain('phaseOverride?.override_service_id ?? entry.service_id');
    expect(billingEngineSource).toContain('phaseOverride?.override_service_name ?? entry.service_name');
  });

  it('T016: a second run straddles a hard cap and a third run bills zero', () => {
    const projectConfig = config({
      billing_model: 'time_and_materials',
      total_price: null,
      cap_amount: 10_000,
      cap_behavior: 'hard_cap',
    });
    const billingContext = context([projectConfig], []);
    billingContext.capUsageByConfigId.set('config-1', {
      config_id: 'config-1',
      billed_amount: 8_500,
      written_down_amount: 0,
      notified_thresholds: [],
    });
    const secondRun = [{
      type: 'time',
      total: 2_000,
      tax_amount: 200,
      project_billing_config_id: 'config-1',
    }];

    (engine as any).applyProjectCapAdjustments(secondRun, billingContext);
    expect(secondRun[0]).toMatchObject({
      total: 1_500,
      tax_amount: 150,
      write_down_amount: 500,
      write_down_reason: 'project_cap',
    });
    expect(8_500 + secondRun[0].total).toBe(10_000);

    billingContext.capUsageByConfigId.set('config-1', {
      config_id: 'config-1',
      billed_amount: 10_000,
      written_down_amount: 500,
      notified_thresholds: [],
    });
    const thirdRun = [{ type: 'time', total: 1_000, tax_amount: 100, project_billing_config_id: 'config-1' }];
    (engine as any).applyProjectCapAdjustments(thirdRun, billingContext);
    expect(thirdRun[0]).toMatchObject({ total: 0, tax_amount: 0, write_down_amount: 1_000 });
  });

  it('T017: notify caps do not write down and dedupe threshold crossings across runs', () => {
    const projectConfig = config({
      billing_model: 'time_and_materials',
      total_price: null,
      cap_amount: 10_000,
      cap_behavior: 'notify',
      cap_notify_thresholds: [50, 75, 100],
    });
    const billingContext = context([projectConfig], []);
    billingContext.capUsageByConfigId.set('config-1', {
      config_id: 'config-1',
      billed_amount: 4_000,
      written_down_amount: 0,
      notified_thresholds: [],
    });
    const firstCharge = [{ type: 'time', total: 4_000, tax_amount: 0, project_billing_config_id: 'config-1' }];

    const first = (engine as any).applyProjectCapAdjustments(firstCharge, billingContext);
    expect(firstCharge[0]).toMatchObject({ total: 4_000 });
    expect(firstCharge[0]).not.toHaveProperty('write_down_amount');
    expect(first.thresholdCrossings.map((crossing: any) => crossing.threshold)).toEqual([50, 75]);

    billingContext.capUsageByConfigId.set('config-1', {
      config_id: 'config-1',
      billed_amount: 8_000,
      written_down_amount: 0,
      notified_thresholds: [50, 75],
    });
    const second = (engine as any).applyProjectCapAdjustments(
      [{ type: 'time', total: 500, tax_amount: 0, project_billing_config_id: 'config-1' }],
      billingContext,
    );
    expect(second.thresholdCrossings).toEqual([]);
  });
});

describe('project billing engine orchestration', () => {
  let engine: BillingEngine;

  beforeEach(() => {
    engine = new BillingEngine();
    identityAdjustments(engine);
  });

  it('T013: standalone T&M combines project contract time, unresolved time, materials, and milestones', async () => {
    const projectConfig = config({
      billing_model: 'time_and_materials',
      total_price: null,
      invoice_mode: 'standalone',
    });
    const milestone = entry({ amount: 2_500 });
    const billingContext = context([projectConfig], [milestone]);
    const contractLine = { client_contract_line_id: 'line-1', currency_code: 'USD' };
    const contractTime = { type: 'time', entryId: 'time-contract', serviceName: 'Engineering', total: 4_000 };
    const unresolvedTime = { type: 'time', entryId: 'time-unresolved', serviceName: 'Analysis', total: 1_500 };
    const material = { type: 'product', serviceName: 'Hardware', total: 3_000 };

    vi.spyOn(engine as any, 'getClientContractLinesForBillingPeriod').mockResolvedValue([contractLine]);
    vi.spyOn(engine as any, 'loadProjectBillingContext').mockResolvedValue(billingContext);
    vi.spyOn(engine as any, 'calculateTimeBasedCharges').mockResolvedValue([contractTime]);
    vi.spyOn(engine as any, 'calculateMaterialCharges').mockResolvedValue([material]);
    vi.spyOn(engine as any, 'calculateUnresolvedNonContractCharges').mockResolvedValue([unresolvedTime]);

    const result = await (engine as any).calculateBillingForPreparedPeriod(
      'client-1',
      PERIOD,
      CLIENT,
      { projectTarget: { projectId: 'project-1' } },
    );

    expect(result.charges.map((charge: any) => [charge.type, charge.total])).toEqual([
      ['time', 4_000],
      ['product', 3_000],
      ['project_milestone', 2_500],
      ['time', 1_500],
    ]);
    expect(result.totalAmount).toBe(11_000);
  });

  it('T014: fixed-price standalone projects exclude contract, unresolved, and material activity', async () => {
    const projectConfig = config({ invoice_mode: 'standalone' });
    const billingContext = context([projectConfig], [entry({ amount: 10_000 })]);
    const calculateTime = vi.spyOn(engine as any, 'calculateTimeBasedCharges');
    const calculateMaterials = vi.spyOn(engine as any, 'calculateMaterialCharges');
    const calculateUnresolved = vi.spyOn(engine as any, 'calculateUnresolvedNonContractCharges');

    vi.spyOn(engine as any, 'getClientContractLinesForBillingPeriod').mockResolvedValue([
      { client_contract_line_id: 'line-1', currency_code: 'USD' },
    ]);
    vi.spyOn(engine as any, 'loadProjectBillingContext').mockResolvedValue(billingContext);

    const result = await (engine as any).calculateBillingForPreparedPeriod(
      'client-1',
      PERIOD,
      CLIENT,
      { projectTarget: { projectId: 'project-1' } },
    );

    expect(result.charges).toEqual([expect.objectContaining({ type: 'project_milestone', total: 10_000 })]);
    expect(calculateTime).not.toHaveBeenCalled();
    expect(calculateMaterials).not.toHaveBeenCalled();
    expect(calculateUnresolved).not.toHaveBeenCalled();
  });

  it('T021: no-config golden scenario preserves legacy contract/time/material/bucket output byte-for-byte', async () => {
    const fixed = { type: 'fixed', serviceName: 'Managed services', total: 10_000, rate: 10_000, quantity: 1 };
    const ticketTime = { type: 'time', serviceName: 'Ticket support', entryId: 'ticket-time', total: 3_000, rate: 12_000, quantity: 0.25 };
    const projectTime = { type: 'time', serviceName: 'Project support', entryId: 'project-time', total: 6_000, rate: 12_000, quantity: 0.5 };
    const bucket = { type: 'bucket', serviceName: 'Support hours', total: 0, rate: 0, quantity: 1 };
    const material = { type: 'product', serviceName: 'Replacement drive', total: 15_000, rate: 15_000, quantity: 1 };
    const expected = {
      charges: [fixed, ticketTime, projectTime, bucket, material],
      totalAmount: 34_000,
      discounts: [],
      adjustments: [],
      finalAmount: 34_000,
      currency_code: 'USD',
    };

    vi.spyOn(engine as any, 'validateBillingPeriod').mockResolvedValue({ success: true });
    vi.spyOn(engine as any, 'getClientContractLinesAndCycle').mockResolvedValue({
      clientContractLines: [{ client_contract_line_id: 'line-1', currency_code: 'USD', contract_line_name: 'Gold plan' }],
      billingCycle: 'monthly',
    });
    vi.spyOn(engine as any, 'buildRecurringTimingSelections').mockReturnValue({});
    vi.spyOn(engine as any, 'loadProjectBillingContext').mockResolvedValue(null);
    vi.spyOn(engine as any, 'calculateFixedPriceCharges').mockResolvedValue([fixed]);
    vi.spyOn(engine as any, 'calculateTimeBasedCharges').mockResolvedValue([ticketTime, projectTime]);
    vi.spyOn(engine as any, 'calculateUsageBasedCharges').mockResolvedValue([]);
    vi.spyOn(engine as any, 'calculateBucketPlanCharges').mockResolvedValue([bucket]);
    vi.spyOn(engine as any, 'calculateProductCharges').mockResolvedValue([]);
    vi.spyOn(engine as any, 'calculateLicenseCharges').mockResolvedValue([]);
    vi.spyOn(engine as any, 'calculateMaterialCharges').mockResolvedValue([material]);

    const actual = await (engine as any).calculateBillingForPreparedPeriod(
      'client-1',
      PERIOD,
      CLIENT,
    );

    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    expect(actual.charges.every((charge: any) => !('project_billing_config_id' in charge))).toBe(true);
    expect(actual).not.toHaveProperty('projectCapThresholdCrossings');
  });
});
