import logger from '@alga-psa/core/logger';
import { runOpportunityDiscipline } from '@alga-psa/opportunities/lib';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';

export interface OpportunityDisciplineJobData extends Record<string, unknown> {
  tenantId: string;
}

export async function opportunityDisciplineHandler(data: OpportunityDisciplineJobData): Promise<void> {
  if (!data.tenantId) throw new Error('Tenant ID is required for the opportunity discipline job');
  await runWithTenant(data.tenantId, async () => {
    const knex = await getConnection(data.tenantId);
    const result = await runOpportunityDiscipline(knex, data.tenantId);
    logger.info('[opportunityDisciplineHandler] Discipline scan complete', {
      tenantId: data.tenantId,
      ...result,
    });
  });
}
