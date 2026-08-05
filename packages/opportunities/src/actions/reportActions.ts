'use server';

import { createTenantKnex, resolveEffectiveTimeZone, tenantDb } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import type { IOpportunityDashboardSnapshot } from '@alga-psa/types';
import {
  closingWindowRange,
  currentQuarterRange,
  mapPipelineStageRows,
  oneTimeCents,
  summarizePipelineReport,
  type IOpportunityPipelineReportCurrency,
} from '../lib/pipelineReporting';
import { assembleWorkQueue } from './workQueueActions';

export const getOpportunityDashboardSnapshot = withAuth(async (
  user,
  { tenant },
): Promise<IOpportunityDashboardSnapshot> => {
  if (!await hasPermission(user as any, 'opportunities', 'read')) {
    throw new Error('Permission denied: opportunities read required');
  }
  const userId = (user as { user_id?: string } | null)?.user_id;
  if (!userId) throw new Error('user is not logged in');
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const pipelineRows = await db.table('opportunities')
    .where({ status: 'open' })
    .groupBy('stage', 'currency_code')
    .select('stage', 'currency_code')
    .count({ opportunity_count: '*' })
    .sum({ mrr_cents: 'mrr_cents', nrr_cents: 'nrr_cents', hardware_cents: 'hardware_cents' });
  const queue = await assembleWorkQueue(
    knex,
    tenant,
    userId,
    String((user as { first_name?: string }).first_name ?? ''),
  );
  const pipelineByStage = mapPipelineStageRows(pipelineRows as Array<Record<string, unknown>>);
  return {
    open_count: pipelineByStage.reduce((sum, row) => sum + row.opportunity_count, 0),
    pipeline_by_stage: pipelineByStage,
    queue_counts: {
      actions_due: queue.do_today.length,
      stalled: queue.going_quiet.length,
    },
  };
});

export interface IOpportunityPipelineReport {
  quarter_label: string;
  by_currency: IOpportunityPipelineReportCurrency[];
}

/** pg hands DATE columns back as local-midnight Dates; recover the calendar date without a UTC shift. */
function asDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value);
}

/**
 * The Reports tab: total open pipeline, a base-rate weighted forecast, what
 * closes in the next 30 days, and new MRR won this quarter. Every one-time
 * number here is NRR + hardware, same as the pipeline table.
 */
export const getOpportunityPipelineReport = withAuth(async (
  user,
  { tenant },
): Promise<IOpportunityPipelineReport> => {
  if (!await hasPermission(user as any, 'opportunities', 'read')) {
    throw new Error('Permission denied: opportunities read required');
  }
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const now = new Date();
  // Quarter and 30-day boundaries live on the tenant's calendar, same as the
  // work queue, falling back to UTC when no timezone is configured.
  const timezone = await resolveEffectiveTimeZone(knex, tenant);
  const quarter = currentQuarterRange(now, timezone);
  const window = closingWindowRange(now, timezone);

  // Aggregate in SQL rather than shipping the whole open book over the wire.
  // Close dates only survive grouping when they fall inside the 30-day window,
  // so the result stays a handful of rows while summarizePipelineReport keeps
  // seeing the per-stage shape (plus a dated row per closing deal-day).
  const closeWindow = 'CASE WHEN expected_close_date >= ? AND expected_close_date <= ? THEN expected_close_date END';
  const [open, won] = await Promise.all([
    db.table('opportunities')
      .where({ status: 'open' })
      .groupBy('stage', 'currency_code')
      // "3" is the CASE expression's position in the select list; repeating a
      // parameterized expression would read as a different one to Postgres.
      .groupByRaw('3')
      .select('stage', 'currency_code', knex.raw(`${closeWindow} AS expected_close_date`, [window.start, window.end]))
      .count({ opportunity_count: '*' })
      .sum({ mrr_cents: 'mrr_cents', nrr_cents: 'nrr_cents', hardware_cents: 'hardware_cents' }),
    db.table('opportunities')
      .where({ status: 'won' })
      .where('won_at', '>=', quarter.start)
      .where('won_at', '<', quarter.endExclusive)
      .groupBy('currency_code')
      .select('currency_code')
      .count({ opportunity_count: '*' })
      .sum({ mrr_cents: 'mrr_cents', nrr_cents: 'nrr_cents', hardware_cents: 'hardware_cents' }),
  ]);

  return {
    quarter_label: quarter.label,
    by_currency: summarizePipelineReport(
      open.map((row: Record<string, unknown>) => ({
        stage: row.stage as never,
        currency_code: String(row.currency_code),
        opportunity_count: Number(row.opportunity_count ?? 0),
        mrr_cents: Number(row.mrr_cents ?? 0),
        one_time_cents: oneTimeCents(row as never),
        expected_close_date: asDateString(row.expected_close_date),
      })),
      won.map((row: Record<string, unknown>) => ({
        currency_code: String(row.currency_code),
        opportunity_count: Number(row.opportunity_count ?? 0),
        mrr_cents: Number(row.mrr_cents ?? 0),
        one_time_cents: oneTimeCents(row as never),
      })),
      now,
      timezone,
    ),
  };
});
