import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CustodyCloseReason, IAssetCustody } from '@alga-psa/types';
import { CustodyError } from './errors';
import { writeCustodyHistory } from './history';
import { CUSTODY_COLUMNS, FOLLOW_UP_SELECT, loadCustody, mapCustodyRow } from './shared';

/**
 * Close an open episode WITHOUT the device coming back to the client (C5 extension of C4).
 *
 * C4's `recordCustodyEvent` only ever closes as `returned_to_client`. A vendor credit ends the stay
 * differently: the vendor keeps (or scraps) the device. `asset_custody.close_reason` already allows
 * `disposed`; this core is the one path that writes it. Same table, same state (`closed`), same
 * history row family, and the caller publishes `ASSET_CUSTODY_CHANGED` exactly as for any other step.
 *
 * It appends no `asset_custody_events` row: the event vocabulary is physical movement and nothing
 * moved. The asset's status is left alone — a disposed device's lifecycle status is a separate decision.
 */
export type ClosableCustodyReason = Extract<CustodyCloseReason, 'disposed'>;

export interface CloseCustodyEpisodeResult {
  custody: IAssetCustody;
  occurredAt: string;
}

export async function closeCustodyEpisode(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  custodyId: string,
  reason: ClosableCustodyReason,
  options: { note?: string | null; rmaId?: string | null; rmaNumber?: string | null } = {}
): Promise<CloseCustodyEpisodeResult> {
  const current = await loadCustody(trx, tenant, custodyId, { forUpdate: true });
  if (current.state === 'closed') {
    throw new CustodyError('episode_closed', 'This custody episode is already closed.');
  }
  const now = new Date().toISOString();
  const [updated] = await tenantDb(trx, tenant)
    .table('asset_custody')
    .where({ custody_id: custodyId })
    .update({ state: 'closed', closed_at: now, closed_by: actorUserId, close_reason: reason, updated_at: now })
    .returning([...CUSTODY_COLUMNS, trx.raw(FOLLOW_UP_SELECT)] as any);
  await writeCustodyHistory(trx, tenant, {
    assetId: current.asset_id,
    actorUserId,
    changeType: `custody_${reason}`,
    at: now,
    changes: {
      custody_id: custodyId,
      close_reason: reason,
      from_state: current.state,
      ticket_id: current.ticket_id,
      rma_id: options.rmaId ?? null,
      rma_number: options.rmaNumber ?? null,
      note: options.note ?? null,
    },
  });
  return { custody: mapCustodyRow(updated), occurredAt: now };
}
