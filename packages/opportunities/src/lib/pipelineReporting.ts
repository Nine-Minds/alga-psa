import type { OpportunityStage } from '@alga-psa/types';

/**
 * One-time value is always NRR + hardware. Every surface that shows a
 * non-recurring number must go through here so the dashboard, the pipeline
 * table and the board can never disagree by a hardware line.
 */
export function oneTimeCents(row: { nrr_cents?: number | string | null; hardware_cents?: number | string | null }): number {
  return Number(row.nrr_cents ?? 0) + Number(row.hardware_cents ?? 0);
}

export interface PipelineStageRow {
  stage: OpportunityStage;
  currency_code: string;
  opportunity_count: number;
  mrr_cents: number;
  nrr_cents: number;
  hardware_cents: number;
}

/** Normalizes the raw grouped sums (knex returns strings for BIGINT sums). */
export function mapPipelineStageRows(rows: Array<Record<string, unknown>>): PipelineStageRow[] {
  return rows.map((row) => ({
    stage: row.stage as OpportunityStage,
    currency_code: String(row.currency_code),
    opportunity_count: Number(row.opportunity_count ?? 0),
    mrr_cents: Number(row.mrr_cents ?? 0),
    nrr_cents: Number(row.nrr_cents ?? 0),
    hardware_cents: Number(row.hardware_cents ?? 0),
  }));
}

/**
 * Evidence-stage base close rates. The EE forecast replaces these with each
 * seller's own history once they have enough closed deals; the CE reports tab
 * only ever uses the base rates.
 */
export const OPPORTUNITY_STAGE_BASE_RATES: Readonly<Record<Exclude<OpportunityStage, 'won' | 'lost'>, number>> = {
  identified: 0.05,
  qualified: 0.15,
  assessment: 0.35,
  proposed: 0.5,
  verbal: 0.8,
};

export function stageBaseRate(stage: OpportunityStage): number {
  return OPPORTUNITY_STAGE_BASE_RATES[stage as Exclude<OpportunityStage, 'won' | 'lost'>]
    ?? OPPORTUNITY_STAGE_BASE_RATES.identified;
}

export interface PipelineReportRow {
  stage: OpportunityStage;
  currency_code: string;
  opportunity_count: number;
  mrr_cents: number;
  /** NRR + hardware. */
  one_time_cents: number;
  expected_close_date?: string | Date | null;
}

export interface ClosedReportRow {
  currency_code: string;
  mrr_cents: number;
  one_time_cents: number;
}

export interface IOpportunityPipelineReportCurrency {
  currency_code: string;
  open_count: number;
  open_mrr_cents: number;
  open_one_time_cents: number;
  /** Base-rate weighted pipeline — the "if history repeats" number. */
  weighted_mrr_cents: number;
  weighted_one_time_cents: number;
  closing_30d_count: number;
  closing_30d_mrr_cents: number;
  closing_30d_one_time_cents: number;
  won_quarter_count: number;
  won_quarter_mrr_cents: number;
  won_quarter_one_time_cents: number;
}

/**
 * Builds the CE Reports tab numbers from open + won-this-quarter rows.
 * Grouped per currency: totalling across currencies would be a lie.
 */
export function summarizePipelineReport(
  open: PipelineReportRow[],
  wonThisQuarter: ClosedReportRow[],
  now: Date,
): IOpportunityPipelineReportCurrency[] {
  const horizon = new Date(now.getTime());
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  const byCurrency = new Map<string, IOpportunityPipelineReportCurrency>();
  const bucket = (currency: string): IOpportunityPipelineReportCurrency => {
    const existing = byCurrency.get(currency);
    if (existing) return existing;
    const created: IOpportunityPipelineReportCurrency = {
      currency_code: currency,
      open_count: 0,
      open_mrr_cents: 0,
      open_one_time_cents: 0,
      weighted_mrr_cents: 0,
      weighted_one_time_cents: 0,
      closing_30d_count: 0,
      closing_30d_mrr_cents: 0,
      closing_30d_one_time_cents: 0,
      won_quarter_count: 0,
      won_quarter_mrr_cents: 0,
      won_quarter_one_time_cents: 0,
    };
    byCurrency.set(currency, created);
    return created;
  };

  for (const row of open) {
    const target = bucket(row.currency_code);
    const rate = stageBaseRate(row.stage);
    target.open_count += row.opportunity_count;
    target.open_mrr_cents += row.mrr_cents;
    target.open_one_time_cents += row.one_time_cents;
    target.weighted_mrr_cents += Math.round(row.mrr_cents * rate);
    target.weighted_one_time_cents += Math.round(row.one_time_cents * rate);
    if (row.expected_close_date) {
      const close = new Date(row.expected_close_date);
      if (!Number.isNaN(close.getTime()) && close >= now && close <= horizon) {
        target.closing_30d_count += row.opportunity_count;
        target.closing_30d_mrr_cents += row.mrr_cents;
        target.closing_30d_one_time_cents += row.one_time_cents;
      }
    }
  }

  for (const row of wonThisQuarter) {
    const target = bucket(row.currency_code);
    target.won_quarter_count += 1;
    target.won_quarter_mrr_cents += row.mrr_cents;
    target.won_quarter_one_time_cents += row.one_time_cents;
  }

  return [...byCurrency.values()].sort((a, b) => b.open_mrr_cents - a.open_mrr_cents);
}

/** Inclusive start / exclusive end ISO instants for the calendar quarter containing `now`. */
export function currentQuarterRange(now: Date): { start: string; endExclusive: string; label: string } {
  const year = now.getUTCFullYear();
  const quarter = Math.floor(now.getUTCMonth() / 3);
  const start = new Date(Date.UTC(year, quarter * 3, 1));
  const endExclusive = new Date(Date.UTC(year, quarter * 3 + 3, 1));
  return {
    start: start.toISOString(),
    endExclusive: endExclusive.toISOString(),
    label: `Q${quarter + 1} ${year}`,
  };
}
