'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import type { IOpportunityDashboardSnapshot } from '@alga-psa/types';
import {
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
  const quarter = currentQuarterRange(now);

  const [open, won] = await Promise.all([
    db.table('opportunities')
      .where({ status: 'open' })
      .select('stage', 'currency_code', 'mrr_cents', 'nrr_cents', 'hardware_cents', 'expected_close_date'),
    db.table('opportunities')
      .where({ status: 'won' })
      .where('won_at', '>=', quarter.start)
      .where('won_at', '<', quarter.endExclusive)
      .select('currency_code', 'mrr_cents', 'nrr_cents', 'hardware_cents'),
  ]);

  return {
    quarter_label: quarter.label,
    by_currency: summarizePipelineReport(
      open.map((row: Record<string, unknown>) => ({
        stage: row.stage as never,
        currency_code: String(row.currency_code),
        opportunity_count: 1,
        mrr_cents: Number(row.mrr_cents ?? 0),
        one_time_cents: oneTimeCents(row as never),
        expected_close_date: row.expected_close_date as string | Date | null,
      })),
      won.map((row: Record<string, unknown>) => ({
        currency_code: String(row.currency_code),
        mrr_cents: Number(row.mrr_cents ?? 0),
        one_time_cents: oneTimeCents(row as never),
      })),
      now,
    ),
  };
});
