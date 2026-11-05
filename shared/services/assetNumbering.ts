import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { SharedNumberingService } from './numberingService';

export const ASSET_RESERVATION_TTL_MINUTES = 15;

export function normalizeAssetTag(value: string): string {
  // Match PostgreSQL btrim(text)'s U+0020 boundary rule exactly.
  return value.replace(/^ +| +$/g, '').replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

export function formatAssetTag(sequenceValue: string, clientPrefix: string | null | undefined): string {
  const normalizedPrefix = clientPrefix?.trim().toUpperCase() ?? '';
  return `${normalizedPrefix}${sequenceValue}`;
}

export async function clientAssetPrefix(
  db: Knex | Knex.Transaction,
  tenant: string,
  clientId: string | null | undefined,
): Promise<string | null> {
  if (!clientId) return null;
  const row = await tenantDb(db, tenant).table('clients')
    .where({ client_id: clientId })
    .first<{ asset_prefix: string | null }>('asset_prefix');
  return row?.asset_prefix ?? null;
}

export async function nextAssetTag(
  db: Knex | Knex.Transaction,
  tenant: string,
  clientId: string | null | undefined,
): Promise<string> {
  const prefix = await clientAssetPrefix(db, tenant, clientId);
  // Legacy/manual tags and durable printed reservations may occupy numbers the
  // shared counter has not reached. Consume those sequence values, never reuse
  // them, and stop only on a free normalized physical identifier.
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const value = await SharedNumberingService.getNextNumber('ASSET', { knex: db, tenant });
    const tag = formatAssetTag(value, prefix);
    const normalized = normalizeAssetTag(tag);
    const [asset, reservation] = await Promise.all([
      tenantDb(db, tenant).table('assets').where({ asset_tag_normalized: normalized }).first('asset_id'),
      tenantDb(db, tenant).table('asset_number_reservations').where({ normalized_tag: normalized }).first('reservation_id'),
    ]);
    if (!asset && !reservation) return tag;
  }
  throw new Error('Could not find an unused asset number after 10,000 sequence values');
}

export async function previewNextAssetTag(
  db: Knex | Knex.Transaction,
  tenant: string,
  clientId: string | null | undefined,
): Promise<{ tag: string; value: number; padding: number }> {
  const row = await tenantDb(db, tenant).table('next_number')
    .where({ entity_type: 'ASSET' })
    .first<{ last_number: number | string; initial_value: number | string; prefix: string | null; padding_length: number | null }>();
  const initial = Number(row?.initial_value ?? 1);
  const last = Number(row?.last_number ?? 0);
  const value = Math.max(last + 1, initial);
  const padding = Number(row?.padding_length ?? 5);
  const staticPrefix = row?.prefix ?? '';
  const formatted = `${staticPrefix}${String(value).padStart(padding, '0')}`;
  return { tag: formatAssetTag(formatted, await clientAssetPrefix(db, tenant, clientId)), value, padding };
}

export async function reserveAssetNumber(
  trx: Knex.Transaction,
  args: { tenant: string; clientId: string | null; createdBy?: string | null },
): Promise<{ reservationId: string; assetTag: string; expiresAt: string }> {
  const assetTag = await nextAssetTag(trx, args.tenant, args.clientId);
  const expiresAt = new Date(Date.now() + ASSET_RESERVATION_TTL_MINUTES * 60_000).toISOString();
  const [reservation] = await tenantDb(trx, args.tenant).table('asset_number_reservations')
    .insert({
      tenant: args.tenant,
      client_id: args.clientId,
      asset_tag: assetTag,
      normalized_tag: normalizeAssetTag(assetTag),
      state: 'reserved',
      expires_at: expiresAt,
      created_by: args.createdBy ?? null,
    })
    .returning<{ reservation_id: string }[]>(['reservation_id']);
  return { reservationId: reservation.reservation_id, assetTag, expiresAt };
}

/**
 * Expiry is bookkeeping, never number release. A printed expired reservation
 * remains recoverable by scan and may still be committed to its same asset.
 */
export async function commitAssetReservation(
  trx: Knex.Transaction,
  args: { tenant: string; reservationId: string; assetId: string; assetTag: string },
): Promise<void> {
  const db = tenantDb(trx, args.tenant);
  const reservation = await db.table('asset_number_reservations')
    .where({ reservation_id: args.reservationId })
    .forUpdate()
    .first<{ asset_tag: string; state: string; asset_id: string | null }>();
  if (!reservation) throw new Error('Asset number reservation was not found');
  if (normalizeAssetTag(reservation.asset_tag) !== normalizeAssetTag(args.assetTag)) {
    throw new Error('Asset number reservation does not match the submitted asset tag');
  }
  if (reservation.asset_id && reservation.asset_id !== args.assetId) {
    throw new Error('Asset number reservation is already committed to another asset');
  }
  if (!['reserved', 'expired', 'released', 'committed'].includes(reservation.state)) {
    throw new Error(`Asset number reservation cannot be committed from ${reservation.state}`);
  }
  await db.table('asset_number_reservations').where({ reservation_id: args.reservationId }).update({
    state: 'committed', asset_id: args.assetId, updated_at: trx.fn.now(),
  });
}
