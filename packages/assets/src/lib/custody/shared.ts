import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IAssetCustody, IAssetCustodyDetail, IAssetCustodyEvent } from '@alga-psa/types';
import { CustodyError } from './errors';

/** Row-mapping and lookups shared by the custody cores. All reads/writes are tenant-scoped. */

export const CUSTODY_COLUMNS = [
  'custody_id', 'asset_id', 'client_id', 'ticket_id', 'state', 'purpose', 'holder_user_id', 'location_id', 'bin',
  'next_action_party', 'next_action_note', 'condition_note', 'accessories', 'opened_at', 'opened_by', 'closed_at',
  'closed_by', 'close_reason', 'created_at', 'updated_at',
] as const;

/** `date` columns come back as a JS Date at local midnight; always read the calendar string instead. */
export const FOLLOW_UP_SELECT = "to_char(follow_up_on, 'YYYY-MM-DD') as follow_up_on";

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function mapCustodyRow(row: any): IAssetCustody {
  return {
    custody_id: row.custody_id,
    asset_id: row.asset_id,
    client_id: row.client_id,
    ticket_id: row.ticket_id ?? null,
    state: row.state,
    purpose: row.purpose,
    holder_user_id: row.holder_user_id ?? null,
    location_id: row.location_id ?? null,
    bin: row.bin ?? null,
    next_action_party: row.next_action_party,
    next_action_note: row.next_action_note ?? null,
    follow_up_on: row.follow_up_on ?? null,
    condition_note: row.condition_note ?? null,
    accessories: Array.isArray(row.accessories) ? row.accessories : [],
    opened_at: iso(row.opened_at)!,
    opened_by: row.opened_by ?? null,
    closed_at: iso(row.closed_at),
    closed_by: row.closed_by ?? null,
    close_reason: row.close_reason ?? null,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function mapEventRow(row: any): IAssetCustodyEvent {
  return {
    event_id: row.event_id,
    custody_id: row.custody_id,
    asset_id: row.asset_id,
    event_type: row.event_type,
    occurred_at: iso(row.occurred_at)!,
    recorded_at: iso(row.recorded_at)!,
    actor_user_id: row.actor_user_id ?? null,
    from_location_id: row.from_location_id ?? null,
    from_bin: row.from_bin ?? null,
    to_location_id: row.to_location_id ?? null,
    to_bin: row.to_bin ?? null,
    from_holder_user_id: row.from_holder_user_id ?? null,
    to_holder_user_id: row.to_holder_user_id ?? null,
    counterparty: row.counterparty ?? null,
    note: row.note ?? null,
    document_ids: Array.isArray(row.document_ids) ? row.document_ids : [],
  };
}

export async function loadCustody(
  trx: Knex | Knex.Transaction,
  tenant: string,
  custodyId: string,
  options: { forUpdate?: boolean } = {}
): Promise<IAssetCustody> {
  const query = tenantDb(trx, tenant)
    .table('asset_custody')
    .where({ custody_id: custodyId })
    .select(...CUSTODY_COLUMNS, trx.raw(FOLLOW_UP_SELECT));
  if (options.forUpdate) query.forUpdate();
  const row = await query.first();
  if (!row) throw new CustodyError('not_found', 'Custody record not found.');
  return mapCustodyRow(row);
}

export async function loadLocation(trx: Knex | Knex.Transaction, tenant: string, locationId: string) {
  const row = await tenantDb(trx, tenant)
    .table('stock_locations')
    .where({ location_id: locationId })
    .select('location_id', 'name', 'is_active')
    .first();
  if (!row) throw new CustodyError('location_inactive', 'That location does not exist.');
  if (!row.is_active) throw new CustodyError('location_inactive', `"${row.name}" is not an active location.`);
  return { location_id: row.location_id as string, name: row.name as string };
}

export async function loadHolder(trx: Knex | Knex.Transaction, tenant: string, userId: string) {
  const row = await tenantDb(trx, tenant)
    .table('users')
    .where({ user_id: userId })
    .select('user_id', 'first_name', 'last_name', 'user_type', 'is_inactive')
    .first();
  if (!row || row.user_type === 'client' || row.is_inactive) {
    throw new CustodyError('holder_invalid', 'The holder must be an active MSP user.');
  }
  return { user_id: row.user_id as string, name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unknown' };
}

/** Names for a set of ids, to keep history summaries self-describing (no joins at read time). */
export async function locationNames(trx: Knex | Knex.Transaction, tenant: string, ids: Array<string | null | undefined>) {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return new Map<string, string>();
  const rows = await tenantDb(trx, tenant).table('stock_locations').whereIn('location_id', unique).select('location_id', 'name');
  return new Map<string, string>(rows.map((r: any) => [r.location_id, r.name]));
}

export async function userNames(trx: Knex | Knex.Transaction, tenant: string, ids: Array<string | null | undefined>) {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return new Map<string, string>();
  const rows = await tenantDb(trx, tenant).table('users').whereIn('user_id', unique).select('user_id', 'first_name', 'last_name');
  return new Map<string, string>(
    rows.map((r: any) => [r.user_id, [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown'])
  );
}

export type { IAssetCustodyDetail };

export function trimBin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
