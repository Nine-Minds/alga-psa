import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface IOpportunityTimelineEntry {
  interaction_id: string;
  title: string;
  notes?: string | null;
  interaction_date: string;
  user_name: string;
}

/**
 * Lists interactions linked to an opportunity without relying on session state.
 * Callers are responsible for authentication and RBAC checks.
 */
export async function listOpportunityTimelineCore(
  knex: Knex | Knex.Transaction,
  tenant: string,
  opportunityId: string,
  limit = 50,
): Promise<IOpportunityTimelineEntry[]> {
  const db = tenantDb(knex, tenant);
  const opportunity = await db.table('opportunities')
    .where({ opportunity_id: opportunityId })
    .select('opportunity_id', 'created_at')
    .first<{ opportunity_id: string; created_at: string }>();
  if (!opportunity) throw new Error('Opportunity not found');

  const interactionLimit = Math.max(0, limit - 1);
  const rows = interactionLimit === 0 ? [] : await db
    .table('interactions as i')
    .leftJoin('users as u', function joinUsers() {
      this.on('u.user_id', '=', 'i.user_id').andOn('u.tenant', '=', 'i.tenant');
    })
    .where('i.opportunity_id', opportunityId)
    .orderBy('i.interaction_date', 'desc')
    .limit(interactionLimit)
    .select(
      'i.interaction_id',
      'i.title',
      'i.notes',
      'i.interaction_date',
      knex.raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) as user_name"),
    );

  return [
    {
      interaction_id: `opportunity-created:${opportunity.opportunity_id}`,
      title: 'Opportunity created',
      interaction_date: opportunity.created_at,
      user_name: '',
    },
    ...(rows as IOpportunityTimelineEntry[]).reverse(),
  ];
}
