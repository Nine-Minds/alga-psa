'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  listOpportunityTimelineCore,
  type IOpportunityTimelineEntry,
} from '../lib/opportunityTimelineCore';

export type { IOpportunityTimelineEntry } from '../lib/opportunityTimelineCore';

/** The deal's courtship record: interactions linked to the opportunity, newest first. */
export const listOpportunityTimeline = withAuth(
  async (user, { tenant }, opportunityId: string): Promise<IOpportunityTimelineEntry[]> => {
    if (!(await hasPermission(user as any, 'opportunities', 'read'))) {
      throw new Error('Permission denied: opportunities read required');
    }
    const { knex } = await createTenantKnex();
    return listOpportunityTimelineCore(knex, tenant, opportunityId);
  }
);
