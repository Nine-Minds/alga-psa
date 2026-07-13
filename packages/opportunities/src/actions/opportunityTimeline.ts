'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

export interface IOpportunityTimelineEntry {
  interaction_id: string;
  title: string;
  notes?: string | null;
  interaction_date: string;
  user_name: string;
}

/** The deal's courtship record: interactions linked to the opportunity, newest first. */
export const listOpportunityTimeline = withAuth(
  async (user, { tenant }, opportunityId: string): Promise<IOpportunityTimelineEntry[]> => {
    if (!(await hasPermission(user as any, 'opportunities', 'read'))) {
      throw new Error('Permission denied: opportunities read required');
    }
    const { knex } = await createTenantKnex();
    const rows = await tenantDb(knex, tenant)
      .table('interactions as i')
      .leftJoin('users as u', function joinUsers() {
        this.on('u.user_id', '=', 'i.user_id').andOn('u.tenant', '=', 'i.tenant');
      })
      .where('i.opportunity_id', opportunityId)
      .orderBy('i.interaction_date', 'desc')
      .limit(50)
      .select(
        'i.interaction_id',
        'i.title',
        'i.notes',
        'i.interaction_date',
        knex.raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) as user_name")
      );
    return rows as IOpportunityTimelineEntry[];
  }
);
