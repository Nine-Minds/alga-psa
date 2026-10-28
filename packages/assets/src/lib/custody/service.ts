import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth';
import { authorizeAndRedactDocuments } from '@shared/lib/documentAuthorization';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildAssetCreatedPayload, buildAssetUpdatedPayload } from '@alga-psa/workflow-streams';
import type {
  IAssetCustodyDetail,
  IAssetCustodyEventDetail,
  ICustodyLocationOption,
  ICustodyQueueFilters,
  ICustodyQueuePage,
  IUser,
} from '@alga-psa/types';
import {
  createAssetReadContext,
  filterReadableAssets,
  isAssetReadAllowed,
  type AssetAuthUser,
  type AssetReadAuthorizationContext,
} from '../assetReadAuthorization';
import type {
  CustodyEventInput,
  OpenCustodyInput,
  ReceiveEquipmentInput,
  UpdateCustodyPatch,
} from '../schemas/assetCustody.schema';
import { CustodyError } from './errors';
import { openCustody } from './openCustody';
import { receiveEquipmentForTicket, type ReceiveEquipmentResult } from './receiveEquipment';
import { recordCustodyEvent } from './recordCustodyEvent';
import { updateCustodyDetails } from './updateCustodyDetails';
import { getOpenCustodyForAssets, listCustodyEpisodes, listCustodyQueue } from './queries';
import { publishCustodyChanged } from './publishCustodyChanged';
export { resolveCustodyToday } from './today';
import { loadCustody, locationNames, userNames } from './shared';

async function readableCustodyDocuments(
  trx: Knex.Transaction, tenant: string, user: AssetAuthUser, ids: string[]
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const principal = { ...user, tenant } as IUser;
  if (!await hasPermission(principal, 'document', 'read', trx)) return new Set();
  const documents = await tenantDb(trx, tenant).table('documents').whereIn('document_id', [...new Set(ids)]).select('*');
  const visible = user.user_type === 'client' ? documents.filter((doc: any) => doc.is_client_visible === true) : documents;
  const readable = await authorizeAndRedactDocuments(trx, tenant, principal, visible);
  return new Set(readable.map(doc => doc.document_id));
}

async function assertCustodyDocumentsReadable(trx: Knex.Transaction, tenant: string, user: AssetAuthUser, ids: string[]) {
  const readable = await readableCustodyDocuments(trx, tenant, user, ids);
  if (ids.some(id => !readable.has(id))) throw new CustodyError('permission_denied', 'One or more documents are unavailable.');
}

async function associateCustodyDocuments(trx: Knex.Transaction, tenant: string, assetId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return;
  await tenantDb(trx, tenant).table('document_associations').insert(uniqueIds.map(document_id => ({
    tenant, document_id, entity_id: assetId, entity_type: 'asset',
  }))).onConflict(['tenant', 'document_id', 'entity_id', 'entity_type']).ignore();
}

/**
 * Transport-neutral custody services shared by the server actions and the REST controllers.
 * Callers have already checked the RBAC permission (asset:read / asset:update / asset:create); everything
 * here enforces the record-level asset check and answers "not found" for an asset the caller cannot read,
 * so existence is never revealed.
 */

async function assertAssetReadable(
  knex: Knex | Knex.Transaction,
  tenant: string,
  ctx: AssetReadAuthorizationContext,
  assetId: string
): Promise<{ asset_id: string; client_id: string }> {
  const asset = await tenantDb(knex, tenant)
    .table('assets')
    .where({ asset_id: assetId })
    .select('asset_id', 'client_id')
    .first();
  if (!asset || !(await isAssetReadAllowed(knex, tenant, ctx, asset))) {
    throw new CustodyError('not_found', 'Asset not found.');
  }
  return asset;
}

/** Resolve the episode's asset and apply the record-level check, as one "not found" for either miss. */
export async function authorizeCustodyEpisode(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  custodyId: string
) {
  const ctx = await createAssetReadContext(knex, tenant, user);
  let custody;
  try {
    custody = await loadCustody(knex, tenant, custodyId);
  } catch {
    throw new CustodyError('not_found', 'Custody record not found.');
  }
  await assertAssetReadable(knex, tenant, ctx, custody.asset_id).catch(() => {
    throw new CustodyError('not_found', 'Custody record not found.');
  });
  return custody;
}

async function publishAssetStatusChange(
  tenant: string,
  actorUserId: string,
  change: { assetId: string; before: string; after: string } | null,
  occurredAt: string
) {
  if (!change) return;
  try {
    await publishWorkflowEvent({
      eventType: 'ASSET_UPDATED',
      payload: buildAssetUpdatedPayload({
        assetId: change.assetId,
        before: { status: change.before },
        after: { status: change.after },
        updatedPaths: ['status'],
        updatedByUserId: actorUserId,
        updatedAt: occurredAt,
      }),
      ctx: { tenantId: tenant, occurredAt, actor: { actorType: 'USER', actorUserId } },
    });
  } catch (error) {
    console.error(`Post-commit effect failed (tenant=${tenant} asset_id=${change.assetId} event=ASSET_UPDATED):`, error);
  }
}

export async function openCustodyService(knex: Knex, tenant: string, user: AssetAuthUser, input: OpenCustodyInput) {
  const ctx = await createAssetReadContext(knex, tenant, user);
  const result = await knex.transaction(async (trx) => {
    await assertAssetReadable(trx, tenant, ctx, input.asset_id);
    await assertCustodyDocumentsReadable(trx, tenant, user, input.document_ids);
    const opened = await openCustody(trx, tenant, user.user_id, input);
    await associateCustodyDocuments(trx, tenant, input.asset_id, input.document_ids);
    return opened;
  });
  await publishCustodyChanged({
    tenant,
    actorUserId: user.user_id,
    custody: result.custody,
    eventType: 'received',
    occurredAt: result.event.occurred_at,
  });
  return result;
}

export async function receiveEquipmentService(
  knex: Knex,
  tenant: string,
  user: AssetAuthUser,
  input: ReceiveEquipmentInput
): Promise<ReceiveEquipmentResult> {
  const result = await knex.transaction(trx => receiveEquipmentInTransaction(trx, tenant, user, input));
  await publishEquipmentReceived(tenant, user, result);
  return result;
}

export async function receiveEquipmentInTransaction(
  trx: Knex.Transaction, tenant: string, user: AssetAuthUser, input: ReceiveEquipmentInput
): Promise<ReceiveEquipmentResult> {
  const ctx = await createAssetReadContext(trx, tenant, user);
  if (input.asset_id) await assertAssetReadable(trx, tenant, ctx, input.asset_id);
  await assertCustodyDocumentsReadable(trx, tenant, user, input.document_ids);
  return receiveEquipmentForTicket(trx, tenant, user.user_id, input);
}

export async function publishEquipmentReceived(tenant: string, user: AssetAuthUser, result: ReceiveEquipmentResult): Promise<void> {
  const at = result.event.occurred_at;
  if (result.createdAsset) {
    try {
      await publishWorkflowEvent({
        eventType: 'ASSET_CREATED',
        payload: buildAssetCreatedPayload({
          assetId: result.asset.asset_id,
          clientId: result.asset.client_id,
          createdByUserId: user.user_id,
          createdAt: at,
          assetType: result.asset.asset_type,
        }),
        ctx: { tenantId: tenant, occurredAt: at, actor: { actorType: 'USER', actorUserId: user.user_id } },
      });
    } catch (error) {
      console.error(`Post-commit effect failed (tenant=${tenant} asset_id=${result.asset.asset_id} event=ASSET_CREATED):`, error);
    }
  }
  await publishCustodyChanged({ tenant, actorUserId: user.user_id, custody: result.custody, eventType: 'received', occurredAt: at });
}

export async function recordCustodyEventService(
  knex: Knex,
  tenant: string,
  user: AssetAuthUser,
  custodyId: string,
  input: CustodyEventInput
) {
  const result = await knex.transaction(trx => recordCustodyEventInTransaction(trx, tenant, user, custodyId, input));
  await publishRecordedCustodyEvent(tenant, user, result);
  return result;
}

export async function recordCustodyEventInTransaction(
  trx: Knex.Transaction, tenant: string, user: AssetAuthUser, custodyId: string, input: CustodyEventInput
) {
  await authorizeCustodyEpisode(trx, tenant, user, custodyId);
  await assertCustodyDocumentsReadable(trx, tenant, user, input.document_ids);
  const result = await recordCustodyEvent(trx, tenant, user.user_id, custodyId, input);
  await associateCustodyDocuments(trx, tenant, result.event.asset_id, input.document_ids);
  return result;
}

export async function publishRecordedCustodyEvent(
  tenant: string, user: AssetAuthUser, result: Awaited<ReturnType<typeof recordCustodyEventInTransaction>>
): Promise<void> {
  await publishCustodyChanged({
    tenant,
    actorUserId: user.user_id,
    custody: result.custody,
    eventType: result.event.event_type,
    occurredAt: result.event.occurred_at,
  });
  await publishAssetStatusChange(tenant, user.user_id, result.assetStatusChange, result.event.occurred_at);
}

export async function updateCustodyService(
  knex: Knex,
  tenant: string,
  user: AssetAuthUser,
  custodyId: string,
  patch: UpdateCustodyPatch
) {
  await authorizeCustodyEpisode(knex, tenant, user, custodyId);
  const result = await knex.transaction((trx) => updateCustodyDetails(trx, tenant, user.user_id, custodyId, patch));
  if (result.changedFields.length > 0) {
    await publishCustodyChanged({
      tenant,
      actorUserId: user.user_id,
      custody: result.custody,
      eventType: 'updated',
      occurredAt: result.custody.updated_at,
    });
  }
  return result;
}

export async function getAssetCustodyService(
  knex: Knex,
  tenant: string,
  user: AssetAuthUser,
  assetId: string
): Promise<{ open: IAssetCustodyDetail | null; episodes: IAssetCustodyDetail[] }> {
  const ctx = await createAssetReadContext(knex, tenant, user);
  await assertAssetReadable(knex, tenant, ctx, assetId);
  const episodes = await listCustodyEpisodes(knex, tenant, assetId);
  return { open: episodes.find((e) => e.closed_at === null) ?? null, episodes };
}

export async function listCustodyEventsService(
  knex: Knex,
  tenant: string,
  user: AssetAuthUser,
  assetId: string
): Promise<IAssetCustodyEventDetail[]> {
  const ctx = await createAssetReadContext(knex, tenant, user);
  await assertAssetReadable(knex, tenant, ctx, assetId);
  const rows = await tenantDb(knex, tenant)
    .table('asset_custody_events')
    .where({ asset_id: assetId })
    .orderBy('occurred_at', 'asc')
    .orderBy('recorded_at', 'asc')
    .select('*');
  const ids = [...new Set<string>(rows.flatMap((row: any) => Array.isArray(row.document_ids) ? row.document_ids : []))];
  const readable = await knex.transaction(trx => readableCustodyDocuments(trx, tenant, user, ids));
  const locs = await locationNames(knex, tenant, rows.flatMap((r: any) => [r.from_location_id, r.to_location_id]));
  const users = await userNames(
    knex,
    tenant,
    rows.flatMap((r: any) => [r.actor_user_id, r.from_holder_user_id, r.to_holder_user_id])
  );
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  return rows.map((r: any) => ({
    event_id: r.event_id,
    custody_id: r.custody_id,
    asset_id: r.asset_id,
    event_type: r.event_type,
    occurred_at: iso(r.occurred_at),
    recorded_at: iso(r.recorded_at),
    actor_user_id: r.actor_user_id ?? null,
    from_location_id: r.from_location_id ?? null,
    from_bin: r.from_bin ?? null,
    to_location_id: r.to_location_id ?? null,
    to_bin: r.to_bin ?? null,
    from_holder_user_id: r.from_holder_user_id ?? null,
    to_holder_user_id: r.to_holder_user_id ?? null,
    counterparty: r.counterparty ?? null,
    note: r.note ?? null,
    document_ids: Array.isArray(r.document_ids) ? r.document_ids.filter((id: string) => readable.has(id)) : [],
    from_location_name: r.from_location_id ? locs.get(r.from_location_id) ?? null : null,
    to_location_name: r.to_location_id ? locs.get(r.to_location_id) ?? null : null,
    actor_name: r.actor_user_id ? users.get(r.actor_user_id) ?? null : null,
    from_holder_name: r.from_holder_user_id ? users.get(r.from_holder_user_id) ?? null : null,
    to_holder_name: r.to_holder_user_id ? users.get(r.to_holder_user_id) ?? null : null,
  }));
}

export async function listCustodyQueueService(
  knex: Knex,
  tenant: string,
  user: AssetAuthUser,
  filters: ICustodyQueueFilters,
  options: { today: string }
): Promise<ICustodyQueuePage> {
  const ctx = await createAssetReadContext(knex, tenant, user);
  return listCustodyQueue(knex, tenant, ctx, filters, { ...options, userId: user.user_id });
}

/**
 * Open episodes linked to a ticket (the ticket's AssociatedAssets chip), record-level filtered. An
 * episode keyed to the ticket still shows after the ticket closes, because it is keyed off the open row.
 */
export async function listHeldEquipmentService(
  knex: Knex,
  tenant: string,
  user: AssetAuthUser,
  ticketId: string
): Promise<IAssetCustodyDetail[]> {
  const links = await tenantDb(knex, tenant)
    .table('asset_associations')
    .where({ entity_type: 'ticket', entity_id: ticketId })
    .select<Array<{ asset_id: string }>>('asset_id');
  const ids = Array.from(new Set(links.map((l) => l.asset_id)));
  const open = await getOpenCustodyForAssets(knex, tenant, ids);
  if (open.size === 0) return [];
  const assets = await tenantDb(knex, tenant)
    .table('assets')
    .whereIn('asset_id', Array.from(open.keys()))
    .select<Array<{ asset_id: string; client_id: string }>>('asset_id', 'client_id');
  const ctx = await createAssetReadContext(knex, tenant, user);
  const readable = new Set((await filterReadableAssets(knex, tenant, ctx, assets)).map((a) => a.asset_id));
  return Array.from(open.values()).filter((c) => readable.has(c.asset_id));
}

export interface OpenCustodyBadge {
  asset_id: string;
  state: 'in_office' | 'with_vendor';
  /** "Main Office / Shelf B3" while in the office; null while with a vendor. */
  location_label: string | null;
  next_action_party: 'msp' | 'client' | 'vendor';
}

/** Cheap per-asset custody lookup for list badges. Record-level filtered; no free-text notes leave. */
export async function getOpenCustodyBadgesService(
  knex: Knex,
  tenant: string,
  user: AssetAuthUser,
  assetIds: string[]
): Promise<OpenCustodyBadge[]> {
  const ids = Array.from(new Set(assetIds)).slice(0, 500);
  const open = await getOpenCustodyForAssets(knex, tenant, ids);
  if (open.size === 0) return [];
  const assets = await tenantDb(knex, tenant)
    .table('assets')
    .whereIn('asset_id', Array.from(open.keys()))
    .select<Array<{ asset_id: string; client_id: string }>>('asset_id', 'client_id');
  const ctx = await createAssetReadContext(knex, tenant, user);
  const readable = new Set((await filterReadableAssets(knex, tenant, ctx, assets)).map((a) => a.asset_id));
  return Array.from(open.values())
    .filter((c) => readable.has(c.asset_id))
    .map((c) => ({
      asset_id: c.asset_id,
      state: c.state === 'with_vendor' ? ('with_vendor' as const) : ('in_office' as const),
      location_label:
        c.state === 'with_vendor' ? null : [c.location_name, c.bin].filter(Boolean).join(' / ') || null,
      next_action_party: c.next_action_party,
    }));
}

/** Distinct bins previously used at a location, for the bin combobox. Free text stays free text. */
export async function listCustodyBinsService(knex: Knex, tenant: string, locationId: string): Promise<string[]> {
  const rows = await tenantDb(knex, tenant)
    .table('asset_custody')
    .where({ location_id: locationId })
    .whereNotNull('bin')
    .distinct('bin')
    .orderBy('bin', 'asc')
    .limit(200);
  return rows.map((r: any) => r.bin as string);
}

/** Active locations for intake pickers. Only id, name and type leave the server (design D5). */
export async function listCustodyLocationsService(knex: Knex, tenant: string): Promise<ICustodyLocationOption[]> {
  const rows = await tenantDb(knex, tenant)
    .table('stock_locations')
    .where({ is_active: true })
    .orderBy('name', 'asc')
    .select('location_id', 'name', 'location_type', 'is_default');
  return rows.map((r: any) => ({
    location_id: r.location_id,
    name: r.name,
    location_type: r.location_type,
    is_default: Boolean(r.is_default),
  }));
}
