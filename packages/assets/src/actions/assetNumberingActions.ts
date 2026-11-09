'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { previewNextAssetTag, reserveAssetNumber, normalizeAssetTag, effectiveAssetTagSql } from '../lib/assetNumbering';
import { createAssetInTransaction } from './assetActions';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildAssetCreatedPayload } from '@alga-psa/workflow-streams';
import { createAssetReadContext, filterReadableAssets } from '../lib/assetReadAuthorization';
import { activateAssetTagUniquenessForTenant } from '@alga-psa/shared/services/assetTagActivation';

export const previewAssetNumber = withAuth(async (user, { tenant }, clientId: string | null) => {
  if (!await hasPermission(user, 'asset', 'create')) throw new Error('Permission denied: Cannot create assets');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx) => previewNextAssetTag(trx, tenant, clientId));
});

export const reserveAssetNumberForIntake = withAuth(async (user, { tenant }, clientId: string | null) => {
  if (!await hasPermission(user, 'asset', 'create')) throw new Error('Permission denied: Cannot create assets');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx) => reserveAssetNumber(trx, {
    tenant,
    clientId,
    createdBy: user.user_id,
  }));
});

export const createMinimalAssetForLabelIntake = withAuth(async (user, { tenant }, clientId: string, name: string) => {
  if (!await hasPermission(user, 'asset', 'create')) throw new Error('Permission denied: Cannot create assets');
  const { knex } = await createTenantKnex();
  const asset = await withTransaction(knex, async (trx) => {
    const reserved = await reserveAssetNumber(trx, { tenant, clientId, createdBy: user.user_id });
    return createAssetInTransaction(trx, tenant, user.user_id, {
      asset_type: 'unknown',
      client_id: clientId,
      asset_tag: reserved.assetTag,
      asset_number_reservation_id: reserved.reservationId,
      name: name.trim() || `Unidentified equipment ${reserved.assetTag}`,
      status: 'active',
      ownership: 'client',
    }, { requireCustomAttributes: false });
  });
  try {
    await publishWorkflowEvent({
      eventType: 'ASSET_CREATED',
      payload: buildAssetCreatedPayload({
        assetId: asset.asset_id, clientId: asset.client_id, createdByUserId: user.user_id,
        createdAt: asset.created_at, assetType: asset.asset_type, serialNumber: asset.serial_number,
      }),
      ctx: { tenantId: tenant, occurredAt: asset.created_at, actor: { actorType: 'USER', actorUserId: user.user_id } },
    });
  } catch (error) {
    console.error(`Failed publishing ASSET_CREATED for label-first asset ${asset.asset_id}`, error);
  }
  return asset;
});

/** Resume a scanned durable reservation by attaching it to one minimal asset.
 * No counter is touched: the reserved printed tag is transferred to the asset
 * in the same transaction, so retries cannot allocate a replacement label. */
export const completeScannedAssetReservation = withAuth(async (user, { tenant }, reservationId: string) => {
  if (!await hasPermission(user, 'asset', 'create')) throw new Error('Permission denied: Cannot create assets');
  const { knex } = await createTenantKnex();
  const asset = await withTransaction(knex, async (trx) => {
    const reservation = await tenantDb(trx, tenant).table('asset_number_reservations')
      .where({ reservation_id: reservationId }).forUpdate()
      .first<{ asset_tag: string; client_id: string | null; state: string; asset_id: string | null }>();
    if (!reservation || !['reserved', 'expired', 'released'].includes(reservation.state) || reservation.asset_id) {
      throw new Error('This printed asset reservation is no longer available for intake');
    }
    if (!reservation.client_id) throw new Error('This asset reservation has no client. Recreate it through label-first intake.');
    return createAssetInTransaction(trx, tenant, user.user_id, {
      asset_type: 'unknown',
      client_id: reservation.client_id,
      asset_tag: reservation.asset_tag,
      asset_number_reservation_id: reservationId,
      name: `Unidentified equipment ${reservation.asset_tag}`,
      status: 'active',
      ownership: 'client',
    }, { requireCustomAttributes: false });
  });
  try {
    await publishWorkflowEvent({
      eventType: 'ASSET_CREATED',
      payload: buildAssetCreatedPayload({
        assetId: asset.asset_id, clientId: asset.client_id, createdByUserId: user.user_id,
        createdAt: asset.created_at, assetType: asset.asset_type, serialNumber: asset.serial_number,
      }),
      ctx: { tenantId: tenant, occurredAt: asset.created_at, actor: { actorType: 'USER', actorUserId: user.user_id } },
    });
  } catch (error) {
    console.error(`Failed publishing ASSET_CREATED for scanned reservation ${reservationId}`, error);
  }
  return asset;
});

export const findAssetByScannedTag = withAuth(async (user, { tenant }, rawTag: string) => {
  if (!await hasPermission(user, 'asset', 'read')) throw new Error('Permission denied: Cannot view assets');
  const tag = normalizeAssetTag(rawTag);
  if (!tag) return { kind: 'not_found' as const };
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const allMatches = await tenantDb(trx, tenant).table('assets')
      .whereRaw(`${effectiveAssetTagSql()} = ?`, [tag])
      .select('asset_id', 'asset_tag', 'name', 'client_id', 'asset_type');
    const context = await createAssetReadContext(trx, tenant, user as any);
    const visible = await filterReadableAssets(trx, tenant, context, allMatches);
    if (visible.length > 0) {
      if (visible.length > 1) return { kind: 'ambiguous' as const };
      return { kind: 'asset' as const, asset: visible[0] };
    }
    if (allMatches.length > 0) return { kind: 'not_found' as const };
    let reservation = await tenantDb(trx, tenant).table('asset_number_reservations')
      .where({ normalized_tag: tag })
      .whereIn('state', ['reserved', 'expired', 'released'])
      .orderBy('created_at', 'desc')
      .first('reservation_id', 'asset_tag', 'client_id', 'state', 'expires_at');
    if (reservation?.state === 'reserved' && new Date(reservation.expires_at).getTime() <= Date.now()) {
      await tenantDb(trx, tenant).table('asset_number_reservations')
        .where({ reservation_id: reservation.reservation_id, state: 'reserved' })
        .update({ state: 'expired', updated_at: trx.fn.now() });
      reservation = { ...reservation, state: 'expired' };
    }
    return reservation && await hasPermission(user, 'asset', 'create', trx)
      ? { kind: 'reservation' as const, reservation }
      : { kind: 'not_found' as const };
  });
});

export const releaseAssetNumberReservation = withAuth(async (user, { tenant }, reservationId: string) => {
  if (!await hasPermission(user, 'asset', 'create')) throw new Error('Permission denied: Cannot create assets');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const reservation = await tenantDb(trx, tenant).table('asset_number_reservations')
      .where({ reservation_id: reservationId }).forUpdate()
      .first<{ state: string; asset_id: string | null }>();
    if (!reservation) throw new Error('Asset number reservation was not found');
    if (reservation.asset_id || reservation.state === 'committed') throw new Error('A committed asset number cannot be released');
    if (!['reserved', 'expired'].includes(reservation.state)) throw new Error(`Cannot release reservation from ${reservation.state}`);
    await tenantDb(trx, tenant).table('asset_number_reservations').where({ reservation_id: reservationId }).update({
      state: 'released', updated_at: trx.fn.now(),
    });
    return { success: true };
  });
});

export const listAssetTagAudit = withAuth(async (user, { tenant }) => {
  if (!await hasPermission(user, 'settings', 'read')) throw new Error('Permission denied: Cannot view asset numbering settings');
  const { knex } = await createTenantKnex();
  return tenantDb(knex, tenant).table('asset_tag_audit')
    .orderBy('discovered_at', 'asc')
    .select('audit_id', 'asset_id', 'asset_tag', 'normalized_tag', 'reason', 'discovered_at', 'resolved_at', 'resolution_note');
});

export const listAssetClientPrefixes = withAuth(async (user, { tenant }) => {
  if (!await hasPermission(user, 'settings', 'read')) throw new Error('Permission denied: Cannot view asset numbering settings');
  const { knex } = await createTenantKnex();
  return tenantDb(knex, tenant).table('clients')
    .where('is_inactive', false)
    .select('client_id', 'client_name', 'asset_prefix')
    .orderBy('client_name', 'asc');
});

export const getAssetSequenceContinuationReview = withAuth(async (user, { tenant }) => {
  if (!await hasPermission(user, 'settings', 'read')) throw new Error('Permission denied: Cannot view asset numbering settings');
  const { knex } = await createTenantKnex();
  const rows = await tenantDb(knex, tenant).table('assets').select('asset_tag');
  const suffixes = rows.flatMap((row: { asset_tag: string | null }) => {
    const match = /([0-9]+)$/.exec(normalizeAssetTag(row.asset_tag ?? ''));
    return match ? [{ tag: row.asset_tag as string, value: BigInt(match[1]) }] : [];
  });
  const maximum = suffixes.reduce((max, item) => item.value > max ? item.value : max, 0n);
  return {
    scannedTags: rows.length,
    numericSuffixTags: suffixes.length,
    maximumSuffix: maximum.toString(),
    suggestedNextValue: (maximum + 1n).toString(),
    examples: suffixes.filter((item) => item.value === maximum).slice(0, 5).map((item) => item.tag),
  };
});

export const updateClientAssetPrefix = withAuth(async (user, { tenant }, clientId: string, rawPrefix: string) => {
  if (!await hasPermission(user, 'settings', 'update')) throw new Error('Permission denied: Cannot update asset numbering settings');
  const prefix = rawPrefix.replace(/^ +| +$/g, '').replace(/[a-z]/g, (letter) => letter.toUpperCase());
  if (prefix && (prefix.length > 10 || !/^[A-Z0-9-]+$/.test(prefix))) {
    return { success: false, error: 'Use up to 10 letters, digits, or hyphens' };
  }
  const { knex } = await createTenantKnex();
  try {
    const updated = await tenantDb(knex, tenant).table('clients')
      .where({ client_id: clientId })
      .update({ asset_prefix: prefix || null, asset_prefix_normalized: prefix || null, updated_at: knex.fn.now() })
      .returning<{ client_id: string; client_name: string; asset_prefix: string | null }[]>(['client_id', 'client_name', 'asset_prefix']);
    return updated[0]
      ? { success: true, client: updated[0] }
      : { success: false, error: 'Client not found' };
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return { success: false, error: 'This prefix is already assigned to another client in this tenant' };
    }
    throw error;
  }
});

export const markAssetTagAuditReviewed = withAuth(async (user, { tenant }, auditId: string, note: string) => {
  if (!await hasPermission(user, 'settings', 'update')) throw new Error('Permission denied: Cannot update asset numbering settings');
  const resolutionNote = note.trim();
  if (resolutionNote.length < 8) throw new Error('Add a short note describing the human reconciliation decision');
  const { knex } = await createTenantKnex();
  const updated = await tenantDb(knex, tenant).table('asset_tag_audit')
    .where({ audit_id: auditId })
    .whereNull('resolved_at')
    .update({ resolved_at: knex.fn.now(), resolution_note: resolutionNote });
  if (!updated) throw new Error('Unresolved asset tag audit row was not found');
  return { success: true };
});

export const activateAssetTagUniqueness = withAuth(async (user, { tenant }) => {
  if (!await hasPermission(user, 'settings', 'update')) throw new Error('Permission denied: Cannot update asset numbering settings');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx) => activateAssetTagUniquenessForTenant(trx, tenant, user.user_id));
});
