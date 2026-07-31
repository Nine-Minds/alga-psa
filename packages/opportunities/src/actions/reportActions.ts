'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import type { IOpportunityDashboardSnapshot } from '@alga-psa/types';
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
    .sum({ mrr_cents: 'mrr_cents', nrr_cents: 'nrr_cents' });
  const queue = await assembleWorkQueue(
    knex,
    tenant,
    userId,
    String((user as { first_name?: string }).first_name ?? ''),
  );
  return {
    open_count: pipelineRows.reduce((sum, row) => sum + Number(row.opportunity_count), 0),
    pipeline_by_stage: pipelineRows.map((row) => ({
      stage: row.stage,
      currency_code: row.currency_code,
      opportunity_count: Number(row.opportunity_count),
      mrr_cents: Number(row.mrr_cents ?? 0),
      nrr_cents: Number(row.nrr_cents ?? 0),
    })),
    queue_counts: {
      actions_due: queue.do_today.length,
      stalled: queue.going_quiet.length,
    },
  };
});
