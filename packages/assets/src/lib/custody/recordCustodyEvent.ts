import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  HELD_BY_MSP_STATUS,
  type CustodyNextActionParty,
  type IAssetCustody,
  type IAssetCustodyEvent,
} from '@alga-psa/types';
import type { CustodyEventInput } from '../schemas/assetCustody.schema';
import { CustodyError } from './errors';
import { writeCustodyHistory } from './history';
import { assertCustodyTransition, CustodyTransitionError } from './stateMachine';
import {
  loadCustody,
  loadHolder,
  loadLocation,
  locationNames,
  mapCustodyRow,
  mapEventRow,
  CUSTODY_COLUMNS,
  FOLLOW_UP_SELECT,
  trimBin,
  userNames,
} from './shared';

/**
 * Record one physical step on an open episode (design D2): moved, handed_off, shipped, received
 * (back from the vendor) or returned. Inserts exactly one append-only event, updates the episode, and
 * writes one asset_history row, all in the caller's transaction.
 *
 * On `returned`, an asset whose status is still `held_by_msp` moves to `active`; any other status is
 * left alone. This is the only write to `assets` here and it never touches stock, service or billing.
 */
export interface RecordCustodyEventResult {
  custody: IAssetCustody;
  event: IAssetCustodyEvent;
  /** Set when `assets.status` changed, for the post-commit ASSET_UPDATED publish. */
  assetStatusChange: { assetId: string; before: string; after: string } | null;
}

export async function recordCustodyEvent(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  custodyId: string,
  input: CustodyEventInput
): Promise<RecordCustodyEventResult> {
  const db = tenantDb(trx, tenant);
  const current = await loadCustody(trx, tenant, custodyId, { forUpdate: true });

  let nextState;
  try {
    nextState = assertCustodyTransition(current.state, input.event_type);
  } catch (error) {
    if (error instanceof CustodyTransitionError) {
      throw new CustodyError(current.state === 'closed' ? 'episode_closed' : 'invalid_transition', error.message);
    }
    throw error;
  }

  const now = new Date().toISOString();
  const occurredAt = input.occurred_at ?? now;
  if (new Date(occurredAt).getTime() > Date.now() + 60_000) {
    throw new CustodyError('invalid_date', 'The time of this step cannot be in the future.');
  }
  if (new Date(occurredAt).getTime() < new Date(current.opened_at).getTime()) {
    throw new CustodyError('invalid_date', 'The time of this step cannot be before the item was received.');
  }

  const patch: Record<string, unknown> = { state: nextState, updated_at: now };
  const event: Record<string, unknown> = {
    tenant,
    custody_id: custodyId,
    asset_id: current.asset_id,
    event_type: input.event_type,
    occurred_at: occurredAt,
    recorded_at: now,
    actor_user_id: actorUserId,
    from_location_id: current.location_id,
    from_bin: current.bin,
    from_holder_user_id: current.holder_user_id,
    note: input.note,
    document_ids: JSON.stringify(input.document_ids),
  };

  let toLocationId: string | null = current.location_id;
  let toBin: string | null = current.bin;
  let toHolderId: string | null = current.holder_user_id;
  let counterparty: string | null = null;
  let assetStatusChange: RecordCustodyEventResult['assetStatusChange'] = null;

  switch (input.event_type) {
    case 'moved': {
      const newLocationId = input.location_id ?? current.location_id!;
      const newBin = input.bin === undefined ? current.bin : trimBin(input.bin);
      if (newLocationId === current.location_id && newBin === current.bin) {
        throw new CustodyError('no_change', 'The item is already there. Choose a different location or shelf.');
      }
      if (newLocationId !== current.location_id) await loadLocation(trx, tenant, newLocationId);
      toLocationId = newLocationId;
      toBin = newBin;
      patch.location_id = toLocationId;
      patch.bin = toBin;
      break;
    }
    case 'handed_off': {
      if (input.to_holder_user_id === current.holder_user_id) {
        throw new CustodyError('no_change', 'That person already has the item.');
      }
      await loadHolder(trx, tenant, input.to_holder_user_id);
      toHolderId = input.to_holder_user_id;
      patch.holder_user_id = toHolderId;
      break;
    }
    case 'shipped': {
      counterparty = input.counterparty;
      // Out of the building: no location, bin or holder. The from-side stays on the event.
      toLocationId = null;
      toBin = null;
      toHolderId = null;
      Object.assign(patch, { location_id: null, bin: null, holder_user_id: null, next_action_party: 'vendor' satisfies CustodyNextActionParty });
      break;
    }
    case 'received': {
      await loadLocation(trx, tenant, input.location_id);
      const holder = await loadHolder(trx, tenant, input.holder_user_id ?? actorUserId);
      toLocationId = input.location_id;
      toBin = trimBin(input.bin);
      toHolderId = holder.user_id;
      Object.assign(patch, {
        location_id: toLocationId,
        bin: toBin,
        holder_user_id: toHolderId,
        next_action_party: 'msp' satisfies CustodyNextActionParty,
      });
      break;
    }
    case 'returned': {
      counterparty = input.counterparty;
      Object.assign(patch, { closed_at: occurredAt, closed_by: actorUserId, close_reason: 'returned_to_client' });
      toLocationId = null;
      toBin = null;
      toHolderId = null;
      const asset = await db.table('assets').where({ asset_id: current.asset_id }).select('status').first();
      if (asset?.status === HELD_BY_MSP_STATUS) {
        await db.table('assets').where({ asset_id: current.asset_id }).update({ status: 'active', updated_at: now });
        assetStatusChange = { assetId: current.asset_id, before: HELD_BY_MSP_STATUS, after: 'active' };
      }
      break;
    }
  }

  Object.assign(event, {
    to_location_id: toLocationId,
    to_bin: toBin,
    to_holder_user_id: toHolderId,
    counterparty,
  });

  const [insertedEvent] = await db.table('asset_custody_events').insert(event).returning('*');
  const [updated] = await db
    .table('asset_custody')
    .where({ custody_id: custodyId })
    .update(patch)
    .returning([...CUSTODY_COLUMNS, trx.raw(FOLLOW_UP_SELECT)] as any);

  const locNames = await locationNames(trx, tenant, [current.location_id, toLocationId]);
  const usrNames = await userNames(trx, tenant, [current.holder_user_id, toHolderId]);
  let ticketNumber: string | null = null;
  if (current.ticket_id) {
    const t = await db.table('tickets').where({ ticket_id: current.ticket_id }).select('ticket_number').first();
    ticketNumber = t?.ticket_number ?? null;
  }
  await writeCustodyHistory(trx, tenant, {
    assetId: current.asset_id,
    actorUserId,
    changeType: `custody_${input.event_type}`,
    at: now,
    changes: {
      custody_id: custodyId,
      event_type: input.event_type,
      from_location_id: current.location_id,
      from_location_name: current.location_id ? locNames.get(current.location_id) ?? null : null,
      from_bin: current.bin,
      to_location_id: toLocationId,
      to_location_name: toLocationId ? locNames.get(toLocationId) ?? null : null,
      to_bin: toBin,
      from_holder_user_id: current.holder_user_id,
      from_holder_name: current.holder_user_id ? usrNames.get(current.holder_user_id) ?? null : null,
      to_holder_user_id: toHolderId,
      to_holder_name: toHolderId ? usrNames.get(toHolderId) ?? null : null,
      counterparty,
      purpose: current.purpose,
      ticket_id: current.ticket_id,
      ticket_number: ticketNumber,
    },
  });

  return { custody: mapCustodyRow(updated), event: mapEventRow(insertedEvent), assetStatusChange };
}
