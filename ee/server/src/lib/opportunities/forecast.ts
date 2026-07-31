import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  IForecastBand,
  IForecastDealContribution,
  ISellerCalibration,
  OpportunityPeriod,
  OpportunityStage,
} from '@alga-psa/types';

/** Evidence-stage base rates used until a seller has 20 closed deals. */
export const FORECAST_BASE_RATES: Readonly<Record<Exclude<OpportunityStage, 'won' | 'lost'>, number>> = {
  identified: 0.05,
  qualified: 0.15,
  assessment: 0.35,
  proposed: 0.5,
  verbal: 0.8,
};

export const FORECAST_CALIBRATION_MIN_CLOSED_DEALS = 20;

const FORECAST_STAGES = ['identified', 'qualified', 'assessment', 'proposed', 'verbal'] as const;
type ForecastStage = typeof FORECAST_STAGES[number];

export interface ForecastOpportunityRow {
  opportunity_id: string;
  opportunity_number: string;
  title: string;
  owner_id: string;
  status: 'open' | 'won';
  stage: OpportunityStage;
  mrr_cents: number | string;
  nrr_cents: number | string;
  currency_code: string;
}

export interface SellerStageCalibration {
  calibrated: boolean;
  rates: Partial<Record<ForecastStage, number>>;
}

export function calculateForecastBand(
  rows: ForecastOpportunityRow[],
  calibrationBySeller: Map<string, SellerStageCalibration>,
): IForecastBand {
  const composition: IForecastDealContribution[] = rows.map((row) => {
    const mrr = Number(row.mrr_cents ?? 0);
    const nrr = Number(row.nrr_cents ?? 0);
    const won = row.status === 'won';
    const stage = FORECAST_STAGES.includes(row.stage as ForecastStage)
      ? row.stage as ForecastStage
      : 'identified';
    const sellerCalibration = calibrationBySeller.get(row.owner_id);
    const calibratedRate = sellerCalibration?.calibrated
      ? sellerCalibration.rates[stage]
      : undefined;
    const weight = won ? 1 : calibratedRate ?? FORECAST_BASE_RATES[stage];
    const floorEligible = won || (row.status === 'open' && row.stage === 'verbal');
    const floorMrr = floorEligible ? mrr : 0;
    const floorNrr = floorEligible ? nrr : 0;

    // The ceiling always contains the floor, then adds weighted non-floor pipeline.
    // This keeps a verbal base rate of 0.8 visible without allowing an inverted band.
    const weightedMrr = won ? mrr : Math.round(mrr * weight);
    const weightedNrr = won ? nrr : Math.round(nrr * weight);

    return {
      opportunity_id: row.opportunity_id,
      opportunity_number: row.opportunity_number,
      title: row.title,
      owner_id: row.owner_id,
      status: row.status,
      stage: row.stage,
      currency_code: row.currency_code,
      weight,
      weight_source: won ? 'won' : calibratedRate === undefined ? 'base' : 'seller_calibration',
      floor_mrr_cents: floorMrr,
      floor_nrr_cents: floorNrr,
      ceiling_mrr_cents: Math.max(floorMrr, weightedMrr),
      ceiling_nrr_cents: Math.max(floorNrr, weightedNrr),
    };
  });

  return composition.reduce<IForecastBand>((band, deal) => ({
    floor_mrr_cents: band.floor_mrr_cents + deal.floor_mrr_cents,
    floor_nrr_cents: band.floor_nrr_cents + deal.floor_nrr_cents,
    ceiling_mrr_cents: band.ceiling_mrr_cents + deal.ceiling_mrr_cents,
    ceiling_nrr_cents: band.ceiling_nrr_cents + deal.ceiling_nrr_cents,
    composition: [...band.composition, deal],
  }), {
    floor_mrr_cents: 0,
    floor_nrr_cents: 0,
    ceiling_mrr_cents: 0,
    ceiling_nrr_cents: 0,
    composition: [],
  });
}

function endExclusive(period: OpportunityPeriod): string {
  const end = new Date(`${period.end}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString();
}

function reconstructStage(checkpoints: string[]): ForecastStage {
  const stageRank = new Map(FORECAST_STAGES.map((stage, index) => [stage, index]));
  return checkpoints.reduce<ForecastStage>((furthest, checkpoint) => (
    (stageRank.get(checkpoint as ForecastStage) ?? -1) > (stageRank.get(furthest) ?? 0)
      ? checkpoint as ForecastStage
      : furthest
  ), 'identified');
}

interface ClosedDealRow {
  opportunity_id: string;
  owner_id: string;
  status: 'won' | 'lost';
  confidence: 'low' | 'medium' | 'high' | 'committed';
  opportunity_type: string;
  client_id: string;
  won_at: Date | string | null;
  lost_at: Date | string | null;
}

interface SellerHistory {
  sellerId: string;
  sellerName: string;
  deals: Array<ClosedDealRow & { stageAtClose: ForecastStage; attached: boolean }>;
}

async function loadSellerHistory(knex: Knex, tenant: string): Promise<SellerHistory[]> {
  const db = tenantDb(knex, tenant);
  const closed = await db.table('opportunities as o')
    .leftJoin('users as u', function joinUsers() {
      this.on('u.tenant', '=', 'o.tenant').andOn('u.user_id', '=', 'o.owner_id');
    })
    .whereIn('o.status', ['won', 'lost'])
    .select(
      'o.opportunity_id',
      'o.owner_id',
      'o.status',
      'o.confidence',
      'o.opportunity_type',
      'o.client_id',
      'o.won_at',
      'o.lost_at',
      knex.raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS seller_name"),
    ) as Array<ClosedDealRow & { seller_name: string }>;

  if (closed.length === 0) return [];
  const ids = closed.map((deal) => deal.opportunity_id);
  const evidence = await db.table('opportunity_evidence')
    .whereIn('opportunity_id', ids)
    .whereNull('corrected_at')
    .whereIn('checkpoint', ['qualified', 'assessment', 'proposed', 'verbal'])
    .select('opportunity_id', 'checkpoint', 'recorded_at') as Array<{
      opportunity_id: string;
      checkpoint: string;
      recorded_at: Date | string;
    }>;

  const checkpointsByDeal = new Map<string, string[]>();
  for (const fact of evidence) {
    const deal = closed.find((candidate) => candidate.opportunity_id === fact.opportunity_id);
    const closedAt = deal?.status === 'won' ? deal.won_at : deal?.lost_at;
    if (!closedAt || new Date(fact.recorded_at).getTime() <= new Date(closedAt).getTime()) {
      const current = checkpointsByDeal.get(fact.opportunity_id) ?? [];
      current.push(fact.checkpoint);
      checkpointsByDeal.set(fact.opportunity_id, current);
    }
  }

  const wonNewLogo = closed.filter((deal) => deal.status === 'won' && deal.opportunity_type === 'new_logo' && deal.won_at);
  const attachedIds = new Set<string>();
  const contractStarts = wonNewLogo.length
    ? await db.table('client_contracts')
        .where({ is_active: true })
        .whereIn('client_id', [...new Set(wonNewLogo.map((deal) => deal.client_id))])
        .select('client_id', 'start_date') as Array<{ client_id: string; start_date: Date | string }>
    : [];
  for (const deal of wonNewLogo) {
    const wonAt = new Date(deal.won_at as Date | string);
    const through = new Date(wonAt);
    through.setUTCDate(through.getUTCDate() + 60);
    if (contractStarts.some((contract) => (
      contract.client_id === deal.client_id
      && new Date(contract.start_date) >= wonAt
      && new Date(contract.start_date) <= through
    ))) attachedIds.add(deal.opportunity_id);
  }

  const histories = new Map<string, SellerHistory>();
  for (const deal of closed) {
    const history = histories.get(deal.owner_id) ?? {
      sellerId: deal.owner_id,
      sellerName: deal.seller_name || deal.owner_id,
      deals: [],
    };
    history.deals.push({
      ...deal,
      stageAtClose: reconstructStage(checkpointsByDeal.get(deal.opportunity_id) ?? []),
      attached: attachedIds.has(deal.opportunity_id),
    });
    histories.set(deal.owner_id, history);
  }
  return [...histories.values()];
}

function calibrationsFromHistory(histories: SellerHistory[]): Map<string, SellerStageCalibration> {
  return new Map(histories.map((history) => {
    const calibrated = history.deals.length >= FORECAST_CALIBRATION_MIN_CLOSED_DEALS;
    const rates: Partial<Record<ForecastStage, number>> = {};
    if (calibrated) {
      for (const stage of FORECAST_STAGES) {
        const cohort = history.deals.filter((deal) => deal.stageAtClose === stage);
        if (cohort.length > 0) {
          rates[stage] = cohort.filter((deal) => deal.status === 'won').length / cohort.length;
        }
      }
    }
    return [history.sellerId, { calibrated, rates }];
  }));
}

export async function getForecastBandData(
  knex: Knex,
  tenant: string,
  period: OpportunityPeriod,
): Promise<IForecastBand> {
  const db = tenantDb(knex, tenant);
  const open = await db.table('opportunities')
    .where({ status: 'open' })
    .whereBetween('expected_close_date', [period.start, period.end])
    .select('opportunity_id', 'opportunity_number', 'title', 'owner_id', 'status', 'stage', 'mrr_cents', 'nrr_cents', 'currency_code');
  const won = await db.table('opportunities')
    .where({ status: 'won' })
    .where('won_at', '>=', `${period.start}T00:00:00.000Z`)
    .where('won_at', '<', endExclusive(period))
    .select('opportunity_id', 'opportunity_number', 'title', 'owner_id', 'status', 'stage', 'mrr_cents', 'nrr_cents', 'currency_code');
  const histories = await loadSellerHistory(knex, tenant);
  return calculateForecastBand([...open, ...won] as ForecastOpportunityRow[], calibrationsFromHistory(histories));
}

export async function getSellerCalibrationData(
  knex: Knex,
  tenant: string,
): Promise<ISellerCalibration[]> {
  const histories = await loadSellerHistory(knex, tenant);
  return histories.map((history) => {
    const confidence_outcomes = (['low', 'medium', 'high', 'committed'] as const).map((confidence) => {
      const cohort = history.deals.filter((deal) => deal.confidence === confidence);
      const won = cohort.filter((deal) => deal.status === 'won').length;
      return {
        confidence,
        closed_count: cohort.length,
        won_count: won,
        close_rate: cohort.length ? won / cohort.length : 0,
      };
    });
    const newLogos = history.deals.filter((deal) => deal.status === 'won' && deal.opportunity_type === 'new_logo');
    const attached = newLogos.filter((deal) => deal.attached).length;
    return {
      seller_id: history.sellerId,
      seller_name: history.sellerName,
      closed_deal_count: history.deals.length,
      calibrated: history.deals.length >= FORECAST_CALIBRATION_MIN_CLOSED_DEALS,
      confidence_outcomes,
      attach_rate: {
        won_new_logo_count: newLogos.length,
        attached_count: attached,
        rate: newLogos.length ? attached / newLogos.length : 0,
      },
    };
  });
}
