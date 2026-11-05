import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Reviewed per-tenant claim backfill. The shared claim primary key already
 * protects all writes; this marks one tenant as reconciled without a global
 * assets index or requiring other tenants to finish reconciliation. */
export async function activateAssetTagUniquenessForTenant(
  trx: Knex.Transaction,
  tenant: string,
  activatedBy: string,
): Promise<{ success: boolean; error?: string }> {
  const db = tenantDb(trx, tenant);
  const unresolved = await db.table('asset_tag_audit').where({ reason: 'duplicate' }).whereNull('resolved_at')
    .count<{ count: string }[]>({ count: '*' });
  if (Number(unresolved[0]?.count ?? 0) > 0) {
    return { success: false, error: 'Review and reconcile every duplicate tag before activation' };
  }
  const duplicateTags = await trx.raw(`SELECT count(*)::int AS count FROM (
    SELECT tenant, asset_tag_normalized FROM assets WHERE tenant = ? AND asset_tag_normalized IS NOT NULL
    GROUP BY tenant, asset_tag_normalized HAVING count(*) > 1
  ) duplicate_groups`, [tenant]);
  if (Number(duplicateTags.rows[0]?.count ?? 0) > 0) {
    return { success: false, error: 'Duplicate tags remain in storage. Edit the affected assets and review the audit before activation.' };
  }
  const conflictingClaim = await trx.raw(`SELECT 1 FROM assets a
    JOIN asset_tag_claims c ON c.tenant = a.tenant AND c.normalized_tag = a.asset_tag_normalized
   WHERE a.tenant = ? AND c.owner_id <> a.asset_id LIMIT 1`, [tenant]);
  if (conflictingClaim.rows.length) {
    return { success: false, error: 'A tag is held by a pending printed label. Reconcile that intake before activation.' };
  }
  await trx.raw(`INSERT INTO asset_tag_claims (tenant, normalized_tag, asset_tag, owner_kind, owner_id)
    SELECT a.tenant, a.asset_tag_normalized, a.asset_tag, 'asset', a.asset_id
      FROM assets a WHERE a.tenant = ? AND a.asset_tag_normalized IS NOT NULL
    ON CONFLICT (tenant, normalized_tag) DO NOTHING`, [tenant]);
  await db.table('asset_tag_activation').insert({ tenant, activated_by: activatedBy })
    .onConflict('tenant').merge({ activated_at: trx.fn.now(), activated_by: activatedBy });
  return { success: true };
}
