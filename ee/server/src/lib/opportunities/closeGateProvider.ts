import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { OpportunityCloseGate } from '@alga-psa/opportunities/lib/closeGates';
import { TIER_FEATURES } from '@alga-psa/types';

type CountOpenCommitments = (
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
) => Promise<number>;

type HasManagementAccess = (tenant: string) => Promise<boolean>;

const hasManagementAccess: HasManagementAccess = async (tenant) => {
  const { assertTenantTierAccess } = await import('server/src/lib/tier-gating/assertTierAccess');
  try {
    await assertTenantTierAccess(tenant, TIER_FEATURES.OPPORTUNITY_MANAGEMENT);
    return true;
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'TIER_ACCESS_DENIED') return false;
    throw error;
  }
};

const countOpenCommitments: CountOpenCommitments = async (trx, tenant, opportunityId) => {
  const row = await tenantDb(trx, tenant).table('opportunity_commitments')
    .where({ opportunity_id: opportunityId, resolution_status: 'open' })
    .count<{ count: string | number }[]>('* as count')
    .first();
  return Number(row?.count ?? 0);
};

export function createCommitmentsCloseGate(
  countOpen: CountOpenCommitments = countOpenCommitments,
  hasAccess: HasManagementAccess = hasManagementAccess,
): OpportunityCloseGate {
  return {
    id: 'ee.opportunity-commitments',
    async canClose(trx, tenant, opportunityId) {
      if (!await hasAccess(tenant)) return { ok: true };
      const unresolved = await countOpen(trx, tenant, opportunityId);
      return unresolved > 0
        ? {
            ok: false,
            reason: `Resolve or decline ${unresolved} open commitment${unresolved === 1 ? '' : 's'} before marking this opportunity won`,
          }
        : { ok: true };
    },
  };
}

export async function getEnterpriseOpportunityCloseGates(): Promise<OpportunityCloseGate[]> {
  return [createCommitmentsCloseGate()];
}
