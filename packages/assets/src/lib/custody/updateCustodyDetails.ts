import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IAssetCustody } from '@alga-psa/types';
import type { UpdateCustodyPatch } from '../schemas/assetCustody.schema';
import { CustodyError } from './errors';
import { writeCustodyHistory } from './history';
import { CUSTODY_COLUMNS, FOLLOW_UP_SELECT, loadCustody, mapCustodyRow } from './shared';

/**
 * Non-physical edits (purpose, next-action party/note, follow-up date, condition, accessories). These are
 * NOT events: they update the episode and write an `asset_history` row `custody_updated` with a before/after
 * diff. The event log stays the chain of custody.
 *
 * The free-text note is internal working text, so the history diff records only THAT it changed.
 */
const FIELDS = ['purpose', 'next_action_party', 'next_action_note', 'follow_up_on', 'condition_note', 'accessories'] as const;

export interface UpdateCustodyDetailsResult {
  custody: IAssetCustody;
  changedFields: string[];
}

export async function updateCustodyDetails(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  custodyId: string,
  patch: UpdateCustodyPatch
): Promise<UpdateCustodyDetailsResult> {
  const current = await loadCustody(trx, tenant, custodyId, { forUpdate: true });
  if (current.state === 'closed') {
    throw new CustodyError('episode_closed', 'This custody episode is already closed.');
  }

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const update: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (!(field in patch)) continue;
    const next = (patch as Record<string, unknown>)[field] ?? null;
    const before = current[field] ?? null;
    if (JSON.stringify(next) === JSON.stringify(before)) continue;
    update[field] = field === 'accessories' ? JSON.stringify(next) : next;
    changes[field] =
      field === 'next_action_note' || field === 'condition_note'
        ? { before: before === null ? null : '[text]', after: next === null ? null : '[text]' }
        : { before, after: next };
  }

  const changedFields = Object.keys(changes);
  if (changedFields.length === 0) return { custody: current, changedFields };

  const now = new Date().toISOString();
  const [updated] = await tenantDb(trx, tenant)
    .table('asset_custody')
    .where({ custody_id: custodyId })
    .update({ ...update, updated_at: now })
    .returning([...CUSTODY_COLUMNS, trx.raw(FOLLOW_UP_SELECT)] as any);

  await writeCustodyHistory(trx, tenant, {
    assetId: current.asset_id,
    actorUserId,
    changeType: 'custody_updated',
    at: now,
    changes: { custody_id: custodyId, event_type: 'updated', fields: changes },
  });

  return { custody: mapCustodyRow(updated), changedFields };
}
