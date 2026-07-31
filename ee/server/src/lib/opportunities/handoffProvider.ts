import type { Knex } from 'knex';
import type { IOpportunityCommitment } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTenantTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { listCommitmentsData } from './meetingCommitments';

export async function getOpportunityHandoffCommitments(
  knex: Knex | Knex.Transaction,
  tenant: string,
  opportunityId: string,
): Promise<IOpportunityCommitment[]> {
  try {
    await assertTenantTierAccess(tenant, TIER_FEATURES.OPPORTUNITY_MANAGEMENT);
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'TIER_ACCESS_DENIED') return [];
    throw error;
  }
  return listCommitmentsData(knex, tenant, opportunityId);
}
