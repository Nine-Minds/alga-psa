import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * One `asset_history` row per custody step, in the same transaction (design D3). `changes` is a
 * compact, self-describing summary (names included) so the timeline needs no lookups.
 * Never contains `next_action_note`: history is read widely, the note is internal working text.
 */
export async function writeCustodyHistory(
  trx: Knex.Transaction,
  tenant: string,
  entry: {
    assetId: string;
    actorUserId: string;
    changeType: `custody_${string}`;
    changes: Record<string, unknown>;
    at: string;
  }
): Promise<void> {
  await tenantDb(trx, tenant).table('asset_history').insert({
    tenant,
    asset_id: entry.assetId,
    changed_by: entry.actorUserId,
    change_type: entry.changeType,
    changes: JSON.stringify(entry.changes),
    changed_at: entry.at,
  });
}
