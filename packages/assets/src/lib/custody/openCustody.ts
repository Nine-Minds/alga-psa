import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IAssetCustody, IAssetCustodyEvent } from '@alga-psa/types';
import type { OpenCustodyInput } from '../schemas/assetCustody.schema';
import { CustodyError } from './errors';
import { writeCustodyHistory } from './history';
import {
  CUSTODY_COLUMNS,
  FOLLOW_UP_SELECT,
  loadHolder,
  loadLocation,
  mapCustodyRow,
  mapEventRow,
  trimBin,
} from './shared';

/**
 * Open a custody episode on an existing asset and record its `received` event, inside the caller's
 * transaction (design D2/D4). Plain and transaction-taking so C5/C6 can call it in their own.
 *
 * Never touches stock, billing or time: it writes asset_custody, asset_custody_events and
 * asset_history only. The caller owns permission checks and post-commit publishing.
 */
export interface OpenCustodyResult {
  custody: IAssetCustody;
  event: IAssetCustodyEvent;
  assetClientId: string;
}

export async function openCustody(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  input: OpenCustodyInput
): Promise<OpenCustodyResult> {
  const db = tenantDb(trx, tenant);

  const asset = await db
    .table('assets')
    .where({ asset_id: input.asset_id })
    .select('asset_id', 'client_id', 'asset_tag', 'name')
    .first();
  if (!asset) throw new CustodyError('asset_not_found', 'Asset not found.');

  const open = await db
    .table('asset_custody as c')
    .where({ 'c.asset_id': input.asset_id })
    .whereNull('c.closed_at')
    .leftJoin('stock_locations as l', function joinLocation() {
      this.on('l.tenant', 'c.tenant').andOn('l.location_id', 'c.location_id');
    })
    .select('c.custody_id', 'c.state', 'c.bin', 'l.name as location_name')
    .first();
  if (open) {
    const where =
      open.state === 'with_vendor'
        ? 'with the vendor'
        : [open.location_name, open.bin].filter(Boolean).join(' / ') || 'in the office';
    throw new CustodyError('open_episode_exists', `This item is already in custody (${where}).`, {
      custodyId: open.custody_id,
    });
  }

  let ticketNumber: string | null = null;
  if (input.ticket_id) {
    const ticket = await db
      .table('tickets')
      .where({ ticket_id: input.ticket_id })
      .select('ticket_id', 'ticket_number', 'client_id')
      .first();
    if (!ticket) throw new CustodyError('ticket_not_found', 'Ticket not found.');
    if (!ticket.client_id) throw new CustodyError('ticket_has_no_client', 'This ticket has no client. Set a client before receiving equipment.');
    if (ticket.client_id !== asset.client_id) {
      throw new CustodyError('client_mismatch', "This asset belongs to a different client than the ticket.");
    }
    ticketNumber = ticket.ticket_number ?? null;
  }

  const location = await loadLocation(trx, tenant, input.location_id);
  const holderId = input.holder_user_id ?? actorUserId;
  const holder = await loadHolder(trx, tenant, holderId);

  const occurredAt = input.occurred_at ?? new Date().toISOString();
  if (new Date(occurredAt).getTime() > Date.now() + 60_000) {
    throw new CustodyError('invalid_date', 'The received time cannot be in the future.');
  }
  const bin = trimBin(input.bin);
  const now = new Date().toISOString();

  let inserted;
  try {
    [inserted] = await db
      .table('asset_custody')
      .insert({
        tenant,
        asset_id: input.asset_id,
        client_id: asset.client_id,
        ticket_id: input.ticket_id,
        state: 'in_office',
        purpose: input.purpose,
        holder_user_id: holder.user_id,
        location_id: location.location_id,
        bin,
        next_action_party: input.next_action_party,
        next_action_note: input.next_action_note,
        follow_up_on: input.follow_up_on,
        condition_note: input.condition_note,
        accessories: JSON.stringify(input.accessories),
        opened_at: occurredAt,
        opened_by: actorUserId,
        created_at: now,
        updated_at: now,
      })
      .returning([...CUSTODY_COLUMNS, trx.raw(FOLLOW_UP_SELECT)] as any);
  } catch (error: any) {
    // Two receivers racing: the partial unique index is the arbiter.
    if (error?.code === '23505' && String(error?.constraint ?? '').includes('asset_custody_one_open_per_asset')) {
      throw new CustodyError('open_episode_exists', 'This item is already in custody.');
    }
    throw error;
  }

  const [event] = await db
    .table('asset_custody_events')
    .insert({
      tenant,
      custody_id: inserted.custody_id,
      asset_id: input.asset_id,
      event_type: 'received',
      occurred_at: occurredAt,
      recorded_at: now,
      actor_user_id: actorUserId,
      to_location_id: location.location_id,
      to_bin: bin,
      to_holder_user_id: holder.user_id,
      note: input.note,
      document_ids: JSON.stringify(input.document_ids),
    })
    .returning('*');

  await writeCustodyHistory(trx, tenant, {
    assetId: input.asset_id,
    actorUserId,
    changeType: 'custody_received',
    at: now,
    changes: {
      custody_id: inserted.custody_id,
      event_type: 'received',
      to_location_id: location.location_id,
      to_location_name: location.name,
      to_bin: bin,
      to_holder_user_id: holder.user_id,
      to_holder_name: holder.name,
      purpose: input.purpose,
      ticket_id: input.ticket_id,
      ticket_number: ticketNumber,
    },
  });

  return { custody: mapCustodyRow(inserted), event: mapEventRow(event), assetClientId: asset.client_id };
}
