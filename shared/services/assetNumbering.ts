import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { SharedNumberingService } from './numberingService';

export const ASSET_RESERVATION_TTL_MINUTES = 15;

export class AssetTagConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'ASSET_TAG_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'AssetTagConflictError';
  }
}

export function normalizeAssetTag(value: string): string {
  // Match PostgreSQL btrim(text)'s U+0020 boundary rule exactly.
  return value.replace(/^ +| +$/g, '').replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

/** N-1 writers leave identity metadata absent or stale until tenant activation.
 * Read their physical tag; managed rows have a checked, indexed canonical tag. */
export function effectiveAssetTagSql(): string {
  return "(CASE WHEN asset_tag_managed THEN asset_tag_normalized ELSE NULLIF(translate(btrim(asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '') END)";
}

/** Hold the policy stable until the caller persists its asset. Before explicit
 * activation, even new-code rows must remain editable by the previous release. */
export async function assetTagClaimsRequired(trx: Knex.Transaction, tenant: string): Promise<boolean> {
  const policy = await trx('tenants').where({ tenant }).forKeyShare()
    .first<{ asset_tag_claims_required: boolean }>('asset_tag_claims_required');
  if (!policy) throw new Error('Tenant not found');
  return policy.asset_tag_claims_required;
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
  args: { tenant: string; assetTag: string; ownerKind: 'asset' | 'reservation'; ownerId: string },
): Promise<void> {
  const normalized = normalizeAssetTag(args.assetTag);
  if (!normalized) throw new Error('Asset tag cannot be blank');
  const db = tenantDb(trx, args.tenant);
  const existing = await db.table('assets').whereRaw(`${effectiveAssetTagSql()} = ?`, [normalized])
    .whereNot('asset_id', args.ownerId).first<{ asset_id: string }>('asset_id');
  if (existing) throw new AssetTagConflictError('Asset tag already exists in this tenant');
  await db.table('asset_tag_claims').insert({
      tenant: args.tenant, normalized_tag: normalized, asset_tag: args.assetTag,
      owner_kind: args.ownerKind, owner_id: args.ownerId,
      reservation_id: args.ownerKind === 'reservation' ? args.ownerId : null,
    }).onConflict(['tenant', 'normalized_tag']).ignore();
  const claim = await db.table('asset_tag_claims').where({ normalized_tag: normalized }).forUpdate()
    .first<{ owner_kind: string; owner_id: string }>();
  if (!claim) throw new Error('Asset tag claim could not be persisted');
  if (claim.owner_kind === args.ownerKind && claim.owner_id === args.ownerId) return;
  throw new AssetTagConflictError('Asset tag is already claimed in this tenant');
}

/** Claim an identity before inserting an asset, including reservation ownership
 * transfer. The policy lock keeps the enforcement phase stable until the caller
 * persists the returned identity in this same transaction. */
export async function prepareAssetIdentity(
  trx: Knex.Transaction,
  args: { tenant: string; clientId: string | null | undefined; assetTag?: string; reservationId?: string },
): Promise<{ asset_id: string; asset_tag: string; asset_tag_normalized: string; asset_tag_legacy_exempt: false; asset_tag_managed: boolean }> {
  const managed = await assetTagClaimsRequired(trx, args.tenant);
  const assetId = randomUUID();
  let assetTag = args.assetTag ?? '';
  if (args.reservationId) {
    const reservation = await tenantDb(trx, args.tenant).table('asset_number_reservations')
      .where({ reservation_id: args.reservationId }).forUpdate()
      .first<{ asset_tag: string }>('asset_tag');
    if (!reservation) throw new AssetTagConflictError('Asset number reservation was not found');
    if (normalizeAssetTag(assetTag) && normalizeAssetTag(assetTag) !== normalizeAssetTag(reservation.asset_tag)) {
      throw new AssetTagConflictError('Submitted asset tag does not match the reserved label');
    }
    assetTag = reservation.asset_tag;
    await commitAssetReservation(trx, { tenant: args.tenant, reservationId: args.reservationId, assetId, assetTag });
  } else if (normalizeAssetTag(assetTag)) {
    await claimAssetTag(trx, { tenant: args.tenant, assetTag, ownerKind: 'asset', ownerId: assetId });
  } else {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      assetTag = await nextAssetTag(trx, args.tenant, args.clientId);
      try {
        await claimAssetTag(trx, { tenant: args.tenant, assetTag, ownerKind: 'asset', ownerId: assetId });
        break;
      } catch (error) {
        if (!(error instanceof AssetTagConflictError) || attempt === 9_999) throw error;
      }
    }
  }
  return { asset_id: assetId, asset_tag: assetTag, asset_tag_normalized: normalizeAssetTag(assetTag), asset_tag_legacy_exempt: false, asset_tag_managed: managed };
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
      tenantDb(db, tenant).table('assets').whereRaw(`${effectiveAssetTagSql()} = ?`, [normalized]).first('asset_id'),
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
  const preview = await SharedNumberingService.previewNextNumber('ASSET', { knex: db, tenant });
  return {
    tag: formatAssetTag(preview.number, await clientAssetPrefix(db, tenant, clientId)),
    value: preview.value,
    padding: preview.padding ?? 0,
  };
}

export async function reserveAssetNumber(
  trx: Knex.Transaction,
  args: { tenant: string; clientId: string | null; createdBy?: string | null },
): Promise<{ reservationId: string; assetTag: string; expiresAt: string }> {
  const reservationId = randomUUID();
  let assetTag = '';
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    assetTag = await nextAssetTag(trx, args.tenant, args.clientId);
    try {
      await claimAssetTag(trx, { tenant: args.tenant, assetTag, ownerKind: 'reservation', ownerId: reservationId });
      break;
    } catch (error) {
      if (!(error instanceof AssetTagConflictError) || attempt === 9_999) throw error;
    }
  }
  const expiresAt = new Date(Date.now() + ASSET_RESERVATION_TTL_MINUTES * 60_000).toISOString();
  const [reservation] = await tenantDb(trx, args.tenant).table('asset_number_reservations')
    .insert({
      tenant: args.tenant,
      reservation_id: reservationId,
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
  if (!reservation) throw new AssetTagConflictError('Asset number reservation was not found');
  if (normalizeAssetTag(reservation.asset_tag) !== normalizeAssetTag(args.assetTag)) {
    throw new AssetTagConflictError('Asset number reservation does not match the submitted asset tag');
  }
  if (reservation.asset_id && reservation.asset_id !== args.assetId) {
    throw new AssetTagConflictError('Asset number reservation is already committed to another asset');
  }
  if (reservation.state === 'committed' && reservation.asset_id === args.assetId) return;
  if (!['reserved', 'expired', 'released'].includes(reservation.state)) {
    throw new AssetTagConflictError(`Asset number reservation cannot be committed from ${reservation.state}`);
  }
  const collision = await db.table('assets').whereRaw(`${effectiveAssetTagSql()} = ?`, [normalizeAssetTag(args.assetTag)])
    .whereNot('asset_id', args.assetId).first('asset_id');
  if (collision) throw new AssetTagConflictError('Asset tag already exists in this tenant');
  const claim = await db.table('asset_tag_claims')
    .where({ normalized_tag: normalizeAssetTag(args.assetTag) }).forUpdate()
    .first<{ owner_kind: string; owner_id: string; reservation_id: string | null }>();
  if (!claim || claim.owner_kind !== 'reservation' || claim.owner_id !== args.reservationId || claim.reservation_id !== args.reservationId) {
    throw new AssetTagConflictError('Asset number reservation does not own its tag claim');
  }
  await db.table('asset_tag_claims').where({ normalized_tag: normalizeAssetTag(args.assetTag) }).update({
    owner_kind: 'asset', owner_id: args.assetId,
  });
  await db.table('asset_number_reservations').where({ reservation_id: args.reservationId }).update({
    state: 'committed', asset_id: args.assetId, updated_at: trx.fn.now(),
  });
}
