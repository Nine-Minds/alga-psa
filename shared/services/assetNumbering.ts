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

/**
 * One tenant-scoped claim is shared by pending labels and persisted assets.
 * Its primary key is (tenant, normalized_tag), which is enforceable on Citus
 * because the distribution key participates in the key. Claims are retained
 * after release/expiry so a printed label can never be assigned elsewhere.
 */
export async function claimAssetTag(
  trx: Knex.Transaction,
  args: { tenant: string; assetTag: string; ownerKind: 'asset' | 'reservation'; ownerId: string; allowOwnerTransfer?: boolean; transferFromOwnerId?: string },
): Promise<void> {
  const normalized = normalizeAssetTag(args.assetTag);
  if (!normalized) throw new Error('Asset tag cannot be blank');
  const db = tenantDb(trx, args.tenant);
  const existing = await db.table('assets').where({ asset_tag_normalized: normalized })
    .whereNot('asset_id', args.ownerId).first<{ asset_id: string }>('asset_id');
  if (existing) throw new Error('Asset tag already exists in this tenant');
  await db.table('asset_tag_claims').insert({
      tenant: args.tenant, normalized_tag: normalized, asset_tag: args.assetTag,
      owner_kind: args.ownerKind, owner_id: args.ownerId,
    }).onConflict(['tenant', 'normalized_tag']).ignore();
  const claim = await db.table('asset_tag_claims').where({ normalized_tag: normalized }).forUpdate()
    .first<{ owner_kind: string; owner_id: string }>();
  if (!claim) throw new Error('Asset tag claim could not be persisted');
  if (claim.owner_kind === args.ownerKind && claim.owner_id === args.ownerId) return;
  if (!args.allowOwnerTransfer || claim.owner_kind !== 'reservation' || args.ownerKind !== 'asset' || claim.owner_id !== args.transferFromOwnerId) {
    throw new Error('Asset tag is already claimed in this tenant');
  }
  await db.table('asset_tag_claims').where({ normalized_tag: normalized }).update({
      asset_tag: args.assetTag, owner_kind: 'asset', owner_id: args.ownerId,
  });
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
      tenantDb(db, tenant).table('asset_tag_claims').where({ normalized_tag: normalized }).first('owner_id'),
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
  await claimAssetTag(trx, { tenant: args.tenant, assetTag, ownerKind: 'reservation', ownerId: reservation.reservation_id });
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
  if (!['reserved', 'expired', 'released'].includes(reservation.state)) {
    throw new Error(`Asset number reservation cannot be committed from ${reservation.state}`);
  }
  await claimAssetTag(trx, { tenant: args.tenant, assetTag: args.assetTag, ownerKind: 'asset', ownerId: args.assetId, allowOwnerTransfer: true, transferFromOwnerId: args.reservationId });
  await db.table('asset_number_reservations').where({ reservation_id: args.reservationId }).update({
    state: 'committed', asset_id: args.assetId, updated_at: trx.fn.now(),
  });
}
