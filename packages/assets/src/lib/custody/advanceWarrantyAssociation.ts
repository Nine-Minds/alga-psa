import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** States that may still become or represent an advance replacement's dead-unit return obligation. */
export const ACTIVE_ADVANCE_RETURN_STATUSES = [
  'warranty_review', 'open', 'sent_to_vendor', 'replaced', 'repaired',
] as const;

export const SHIPPABLE_ADVANCE_RETURN_STATUSES = ['replaced', 'repaired'] as const;

/** Lock unlinked, asset-owned advance claims before creating a new custody episode. */
export function lockUnlinkedAdvanceReturnsForIntake(
  trx: Knex.Transaction,
  tenant: string,
  assetId: string
) {
  return tenantDb(trx, tenant).table('rma_cases')
    .where({ asset_id: assetId, rma_type: 'advance_replacement' })
    .whereNull('returned_unit_id')
    .whereNull('custody_id')
    .whereIn('status', [...ACTIVE_ADVANCE_RETURN_STATUSES])
    .orderBy('rma_id', 'asc')
    .forUpdate()
    .select('rma_id');
}

/**
 * Lock obligations explicitly linked to this episode plus eligible unlinked claims for this asset's
 * current episode. For a closed episode, legacy recovery is bounded to claims predating its creation.
 */
export function lockAdvanceReturnsForEpisode(
  trx: Knex.Transaction,
  tenant: string,
  episode: { custody_id: string; asset_id: string; created_at: string | Date; state: string }
) {
  const query = tenantDb(trx, tenant).table('rma_cases')
    .where({ rma_type: 'advance_replacement' })
    .whereNull('returned_unit_id')
    .andWhere((query) => query
      .where({ custody_id: episode.custody_id })
      .orWhere((unlinked) => {
        unlinked
          .whereNull('custody_id')
          .where({ asset_id: episode.asset_id })
          .whereIn('status', [...SHIPPABLE_ADVANCE_RETURN_STATUSES]);
        if (episode.state === 'closed') unlinked.where('created_at', '<=', episode.created_at);
      }))
    .orderBy('rma_id', 'asc')
    .forUpdate()
    .select('rma_id', 'rma_type', 'status', 'custody_id');
  return query;
}

/** Lock current active episodes and closed episodes created during or after an unlinked claim. */
export function lockEpisodesForUnlinkedAdvanceReturn(
  trx: Knex.Transaction,
  tenant: string,
  claim: { asset_id: string; created_at: string | Date }
) {
  return tenantDb(trx, tenant).table('asset_custody')
    .where({ asset_id: claim.asset_id })
    .andWhere((query) => query.where('created_at', '>=', claim.created_at).orWhereNull('closed_at'))
    .orderBy('created_at', 'asc')
    .orderBy('custody_id', 'asc')
    .forUpdate()
    .select('custody_id', 'asset_id', 'state', 'close_reason');
}

export async function associateAdvanceReturnWithCustody(
  trx: Knex.Transaction,
  tenant: string,
  rmaId: string,
  custodyId: string
): Promise<boolean> {
  const [updated] = await tenantDb(trx, tenant).table('rma_cases')
    .where({ rma_id: rmaId, rma_type: 'advance_replacement' })
    .whereNull('returned_unit_id')
    .whereNull('custody_id')
    .update({ custody_id: custodyId, updated_at: trx.fn.now() })
    .returning('rma_id');
  return Boolean(updated);
}
