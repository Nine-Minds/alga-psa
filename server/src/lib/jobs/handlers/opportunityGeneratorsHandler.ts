import logger from '@alga-psa/core/logger';
import { runGenerators } from '@alga-psa/opportunities/lib';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';

export interface OpportunityGeneratorsJobData extends Record<string, unknown> {
  tenantId: string;
}

export async function opportunityGeneratorsHandler(data: OpportunityGeneratorsJobData): Promise<void> {
  if (!data.tenantId) throw new Error('Tenant ID is required for the opportunity generators job');
  await runWithTenant(data.tenantId, async () => {
    const knex = await getConnection(data.tenantId);
    const summaries = await runGenerators(knex, data.tenantId);
    logger.info('[opportunityGeneratorsHandler] Generator scan complete', {
      tenantId: data.tenantId,
      summaries,
    });
  });
}
