import logger from '@alga-psa/core/logger';
import { runOpportunityWeeklyDigest } from '@alga-psa/opportunities/lib';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';

export interface OpportunityWeeklyDigestJobData extends Record<string, unknown> {
  tenantId: string;
}

export async function opportunityWeeklyDigestHandler(data: OpportunityWeeklyDigestJobData): Promise<void> {
  if (!data.tenantId) throw new Error('Tenant ID is required for the opportunity weekly digest job');
  await runWithTenant(data.tenantId, async () => {
    const knex = await getConnection(data.tenantId);
    const summaries = await runOpportunityWeeklyDigest(knex, data.tenantId);
    logger.info('[opportunityWeeklyDigestHandler] Weekly digests processed', {
      tenantId: data.tenantId,
      ownerCount: summaries.length,
    });
  });
}
