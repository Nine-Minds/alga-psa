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
  const unresolved = await db.table('asset_tag_audit').whereIn('reason', ['duplicate', 'claim_conflict']).whereNull('resolved_at')
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
   WHERE a.tenant = ? AND c.asset_id IS DISTINCT FROM a.asset_id
     AND (c.owner_kind = 'reservation' OR NOT EXISTS (
       SELECT 1 FROM asset_tag_legacy_bindings legacy WHERE legacy.tenant = a.tenant
         AND legacy.asset_id = a.asset_id AND legacy.normalized_tag = a.asset_tag_normalized
     )) LIMIT 1`, [tenant]);
  if (conflictingClaim.rows.length) {
    return { success: false, error: 'A tag is held by a pending printed label. Reconcile that intake before activation.' };
  }
  // A reviewed legacy group may now have one remaining physical owner. Only
  // its captured original bindings authorize transfer of that holding claim.
  await trx.raw(`UPDATE asset_tag_claims c SET owner_kind = 'asset', owner_id = a.asset_id
    FROM assets a JOIN asset_tag_legacy_bindings legacy
      ON legacy.tenant = a.tenant AND legacy.asset_id = a.asset_id AND legacy.normalized_tag = a.asset_tag_normalized
    WHERE a.tenant = ? AND c.tenant = a.tenant AND c.normalized_tag = a.asset_tag_normalized
      AND c.owner_kind IN ('legacy', 'asset') AND c.asset_id IS DISTINCT FROM a.asset_id`, [tenant]);
  await trx.raw(`INSERT INTO asset_tag_claims (tenant, normalized_tag, asset_tag, owner_kind, owner_id)
    SELECT a.tenant, a.asset_tag_normalized, a.asset_tag, 'asset', a.asset_id
      FROM assets a WHERE a.tenant = ? AND a.asset_tag_normalized IS NOT NULL
    ON CONFLICT (tenant, normalized_tag) DO NOTHING`, [tenant]);
  await db.table('assets').whereNotNull('asset_tag_normalized').update({ asset_tag_legacy_exempt: false });
  await trx.raw(`DELETE FROM asset_tag_legacy_bindings legacy USING assets a
    WHERE legacy.tenant = ? AND a.tenant = legacy.tenant AND a.asset_id = legacy.asset_id
      AND NOT a.asset_tag_legacy_exempt`, [tenant]);
  // Citus requires immutable expressions in an ON CONFLICT update. Bind the
  // timestamp rather than asking each shard to evaluate CURRENT_TIMESTAMP.
  const activatedAt = new Date().toISOString();
  await db.table('asset_tag_activation').insert({ tenant, activated_by: activatedBy, activated_at: activatedAt })
    .onConflict('tenant').merge({ activated_at: activatedAt, activated_by: activatedBy });
  return { success: true };
}
