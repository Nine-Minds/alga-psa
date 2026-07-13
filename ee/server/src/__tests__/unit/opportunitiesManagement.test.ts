import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculateForecastBand,
  type ForecastOpportunityRow,
  type SellerStageCalibration,
} from '../../lib/opportunities/forecast';
import { createCommitmentsCloseGate } from '../../lib/opportunities/closeGateProvider';
import { assembleQbrTriggerPack } from '../../lib/opportunities/qbr';
import {
  registerOpportunityCloseGate,
  resetOpportunityCloseGatesForTests,
  runOpportunityCloseGates,
} from '@alga-psa/opportunities/lib/closeGates';

const seller = '11111111-1111-4111-8111-111111111111';

function deal(
  id: string,
  status: 'open' | 'won',
  stage: ForecastOpportunityRow['stage'],
  mrr: number,
): ForecastOpportunityRow {
  return {
    opportunity_id: id,
    opportunity_number: `OPP-${id}`,
    title: id,
    owner_id: seller,
    status,
    stage,
    mrr_cents: mrr,
    nrr_cents: mrr * 2,
    currency_code: 'USD',
  };
}

describe('enterprise opportunity management behavior', () => {
  beforeEach(() => resetOpportunityCloseGatesForTests());

  it('computes a floor and evidence-weighted ceiling with base-rate fallback', () => {
    const rows = [
      deal('verbal', 'open', 'verbal', 1000),
      deal('qualified', 'open', 'qualified', 1000),
      deal('won', 'won', 'won', 500),
    ];
    const calibration = new Map<string, SellerStageCalibration>([[seller, {
      calibrated: false,
      rates: {},
    }]]);

    const band = calculateForecastBand(rows, calibration);

    expect(band).toMatchObject({
      floor_mrr_cents: 1500,
      floor_nrr_cents: 3000,
      ceiling_mrr_cents: 1650,
      ceiling_nrr_cents: 3300,
    });
    expect(band.composition.find((row) => row.opportunity_id === 'qualified')).toMatchObject({
      weight: 0.15,
      weight_source: 'base',
      ceiling_mrr_cents: 150,
    });
    expect(band.ceiling_mrr_cents).toBeGreaterThanOrEqual(band.floor_mrr_cents);
  });

  it('uses seller calibration for observed cohorts and base rates for sparse cohorts', () => {
    const calibration = new Map<string, SellerStageCalibration>([[seller, {
      calibrated: true,
      rates: { qualified: 0.6 },
    }]]);
    const band = calculateForecastBand([
      deal('qualified', 'open', 'qualified', 1000),
      deal('assessment', 'open', 'assessment', 1000),
    ], calibration);

    expect(band.composition[0]).toMatchObject({ weight: 0.6, weight_source: 'seller_calibration' });
    expect(band.composition[1]).toMatchObject({ weight: 0.35, weight_source: 'base' });
    expect(band.ceiling_mrr_cents).toBe(950);
  });

  it('blocks close-won with open commitments and permits it after resolution', async () => {
    let unresolved = 1;
    registerOpportunityCloseGate(createCommitmentsCloseGate(async () => unresolved, async () => true));

    await expect(runOpportunityCloseGates({} as any, 'tenant', 'opportunity')).rejects.toThrow(
      'Resolve or decline 1 open commitment',
    );

    unresolved = 0;
    await expect(runOpportunityCloseGates({} as any, 'tenant', 'opportunity')).resolves.toBeUndefined();
  });

  it('leaves the CE/core close loop untouched when the management tier is unavailable', async () => {
    let queriedCommitments = false;
    registerOpportunityCloseGate(createCommitmentsCloseGate(
      async () => {
        queriedCommitments = true;
        return 1;
      },
      async () => false,
    ));

    await expect(runOpportunityCloseGates({} as any, 'tenant', 'opportunity')).resolves.toBeUndefined();
    expect(queriedCommitments).toBe(false);
  });

  it('assembles renewal, asset, rising-ticket, and whitespace QBR triggers', () => {
    const pack = assembleQbrTriggerPack({
      client: {
        client_id: '22222222-2222-4222-8222-222222222222',
        client_name: 'Northwind',
        account_manager_id: seller,
        default_currency_code: 'USD',
      },
      renewals: [{
        client_id: '22222222-2222-4222-8222-222222222222',
        title: 'Managed services renewal',
        evidence: { client_contract_id: '33333333-3333-4333-8333-333333333333' },
        mrr_cents: 120000,
        nrr_cents: 0,
        currency_code: 'USD',
        dedupe_key: 'renewal:contract:2026',
      }],
      assetAging: [{
        client_id: '22222222-2222-4222-8222-222222222222',
        title: 'Northwind asset refresh',
        evidence: { count: 8, assets: [{ asset_id: 'asset', is_eol: true }] },
        mrr_cents: 0,
        nrr_cents: 0,
        currency_code: 'USD',
        dedupe_key: 'asset_aging:northwind:2026',
      }],
      ticketTrend: { current_90_days: 24, prior_90_days: 10, window_end: '2026-07-12' },
      whitespace: [{
        category_id: '44444444-4444-4444-8444-444444444444',
        category_name: 'Security',
        adoption_percentage: 75,
        adopted_client_count: 3,
        comparable_client_count: 4,
      }],
    });

    expect(pack.triggers.map((trigger) => trigger.kind)).toEqual([
      'renewal',
      'asset_aging',
      'ticket_trend',
      'whitespace',
    ]);
    expect(pack.triggers.every((trigger) => trigger.default_next_action.length > 0)).toBe(true);
    expect(pack.triggers.find((trigger) => trigger.kind === 'renewal')).toMatchObject({
      opportunity_type: 'renewal',
      generator_key: 'renewal',
      mrr_cents: 120000,
    });
  });
});
