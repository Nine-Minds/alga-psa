'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { previewNextAssetTag, reserveAssetNumber, normalizeAssetTag } from '../lib/assetNumbering';
import { createAssetInTransaction } from './assetActions';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildAssetCreatedPayload } from '@alga-psa/workflow-streams';

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

export const findAssetByScannedTag = withAuth(async (user, { tenant }, rawTag: string) => {
  if (!await hasPermission(user, 'asset', 'read')) throw new Error('Permission denied: Cannot view assets');
  const tag = normalizeAssetTag(rawTag);
  if (!tag) return { kind: 'not_found' as const };
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const allMatches = await tenantDb(trx, tenant).table('assets')
      .where({ asset_tag_normalized: tag })
      .limit(2)
      .select('asset_id', 'asset_tag', 'name', 'client_id', 'asset_type');
    if (allMatches.length > 0) {
      if (allMatches.length > 1) return { kind: 'ambiguous' as const, assetIds: allMatches.map((row) => row.asset_id) };
      return { kind: 'asset' as const, asset: allMatches[0] };
    }
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
    return reservation
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
    const match = /([0-9]+)$/.exec(row.asset_tag ?? '');
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
  const prefix = rawPrefix.trim().toUpperCase();
  if (prefix && (prefix.length > 10 || !/^[A-Z0-9-]+$/.test(prefix))) {
    return { success: false, error: 'Use up to 10 letters, digits, or hyphens' };
  }
  const { knex } = await createTenantKnex();
  try {
    const updated = await tenantDb(knex, tenant).table('clients')
      .where({ client_id: clientId })
      .update({ asset_prefix: prefix || null, updated_at: knex.fn.now() })
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
  const preflight = await withTransaction(knex, async (trx) => {
    const unresolved = await tenantDb(trx, tenant).table('asset_tag_audit')
      .where({ reason: 'duplicate' }).whereNull('resolved_at').count<{ count: string }[]>({ count: '*' });
    if (Number(unresolved[0]?.count ?? 0) > 0) {
      return 'Review and reconcile every duplicate tag before activation';
    }
    const duplicateTags = await trx.raw(`
      SELECT count(*)::int AS count FROM (
        SELECT tenant, asset_tag_normalized FROM assets
         WHERE tenant = ? AND asset_tag_normalized IS NOT NULL
         GROUP BY tenant, asset_tag_normalized HAVING count(*) > 1
      ) duplicate_groups
    `, [tenant]);
    if (Number(duplicateTags.rows[0]?.count ?? 0) > 0) {
      return 'Duplicate tags remain in storage. Edit the affected assets and review the audit before activation.';
    }
    return null;
  });
  if (preflight) return { success: false, error: preflight };
  // The trigger guard is active from migration time. This reviewed index adds
  // a declarative PostgreSQL/Citus constraint after legacy rows are resolved.
  try {
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS assets_tenant_asset_tag_normalized_uq
      ON assets (tenant, asset_tag_normalized) WHERE asset_tag_normalized IS NOT NULL`);
    return { success: true };
  } catch {
    return { success: false, error: 'Could not activate normalized uniqueness. Confirm all tenant duplicates are reconciled and the database role can create the index.' };
  }
});
