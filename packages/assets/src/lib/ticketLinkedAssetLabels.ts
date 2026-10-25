import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { LabelRequestContext } from '@alga-psa/types';

import { createAssetReadContext, isAssetReadAllowed, type AssetAuthUser } from './assetReadAuthorization';
import { getOpenCustodyForAssets } from './custody/queries';
import { formatCustodyForLabel, formatCustodyForLabelMulti } from './custody/labelFormat';

/**
 * The asset half of a ticket work tag: the linked asset's tag and a serial SUFFIX. Read-only.
 *
 * Lives in the assets package because the asset kernel check must run here (tickets never import
 * assets; the composition root merges this into the ticket view models). An asset the caller cannot
 * read never contributes.
 */

export interface TicketLinkedAssetLabelParts {
  assetId: string;
  assetTag: string | null;
  serialSuffix: string | null;
  /** Held-equipment line ("Main Office / Shelf B3", "With vendor", "2 items held"), or null. Never the note. */
  custodyLocation: string | null;
  /** "Waiting on vendor, Oct 29" etc., or null. Derived from party + follow-up date only. */
  nextAction: string | null;
}

/** Serials shorter than this produce no suffix, so the suffix can never be the whole serial. */
export const MIN_SERIAL_LENGTH_FOR_SUFFIX = 8;
export const SERIAL_SUFFIX_LENGTH = 4;

export function serialSuffixOf(serial: string | null | undefined): string | null {
  const value = (serial ?? '').trim();
  if (value.length < MIN_SERIAL_LENGTH_FOR_SUFFIX) {
    return null;
  }
  return value.slice(-SERIAL_SUFFIX_LENGTH);
}

/**
 * For each ticket: the single readable linked asset, or - when `chosen[ticketId]` names a readable
 * asset linked to that ticket - that one; otherwise null (none, several, or unreadable).
 * An invalid or unlinked `chosen` asset is treated as absent (no error, reveals nothing).
 */
export async function getTicketLinkedAssetLabelParts(
  context: LabelRequestContext,
  ticketIds: readonly string[],
  chosen: Record<string, string> = {}
): Promise<Record<string, TicketLinkedAssetLabelParts | null>> {
  const result: Record<string, TicketLinkedAssetLabelParts | null> = {};
  for (const id of ticketIds) {
    result[id] = null;
  }
  if (ticketIds.length === 0 || !(await hasPermission(context.user, 'asset', 'read'))) {
    return result;
  }

  const { knex } = await createTenantKnex(context.tenant);
  const db = tenantDb(knex, context.tenant);
  const links = await db
    .table('asset_associations')
    .where({ entity_type: 'ticket' })
    .whereIn('entity_id', [...ticketIds])
    .select<Array<{ asset_id: string; entity_id: string }>>('asset_id', 'entity_id');
  if (links.length === 0) {
    return result;
  }

  const assetIds = Array.from(new Set(links.map((l) => l.asset_id)));
  const assets = await db
    .table('assets')
    .whereIn('asset_id', assetIds)
    .select<Array<{ asset_id: string; asset_tag: string | null; serial_number: string | null; client_id: string | null }>>(
      'asset_id',
      'asset_tag',
      'serial_number',
      'client_id'
    );
  const byId = new Map(assets.map((a) => [a.asset_id, a]));

  const authContext = await createAssetReadContext(knex, context.tenant, context.user as AssetAuthUser);
  const readable = new Map<string, boolean>();
  const canRead = async (assetId: string) => {
    const known = readable.get(assetId);
    if (known !== undefined) return known;
    const asset = byId.get(assetId);
    const allowed = asset ? await isAssetReadAllowed(knex, context.tenant, authContext, asset) : false;
    readable.set(assetId, allowed);
    return allowed;
  };

  // Custody is shown for every READABLE linked asset (not only the one picked for the asset line): the tag
  // answers "where is the equipment for this ticket". Unreadable assets contribute nothing.
  const readableIds: string[] = [];
  for (const assetId of assetIds) {
    if (await canRead(assetId)) readableIds.push(assetId);
  }
  const custodyByAsset = await getOpenCustodyForAssets(knex, context.tenant, readableIds);

  for (const ticketId of ticketIds) {
    const linked = Array.from(new Set(links.filter((l) => l.entity_id === ticketId).map((l) => l.asset_id)));
    const readableLinked: string[] = [];
    for (const assetId of linked) {
      if (await canRead(assetId)) readableLinked.push(assetId);
    }
    const pick = chosen[ticketId];
    const assetId = pick && readableLinked.includes(pick) ? pick : readableLinked.length === 1 ? readableLinked[0] : null;
    const held = readableLinked.flatMap((id) => {
      const facts = formatCustodyForLabel(custodyByAsset.get(id));
      return facts ? [facts] : [];
    });
    const custody = formatCustodyForLabelMulti(held);
    if (!assetId && !custody) continue;
    // LEVERAGE: friction label-seam-asset-or-custody — the seam was shaped around one linked asset; custody facts
    // are per ticket (all held items), so a null-asset result still carries them (assetId '' = none picked).
    const asset = assetId ? byId.get(assetId)! : null;
    result[ticketId] = {
      assetId: assetId ?? '',
      assetTag: asset?.asset_tag ?? null,
      serialSuffix: asset ? serialSuffixOf(asset.serial_number) : null,
      custodyLocation: custody?.custodyLocation ?? null,
      nextAction: custody?.nextAction ?? null,
    };
  }
  return result;
}

/**
 * The readable assets linked to ONE ticket, for the single-print dialog's picker. Tag and name only.
 */
export async function listTicketLinkedAssetChoices(
  context: LabelRequestContext,
  ticketId: string
): Promise<Array<{ assetId: string; assetTag: string | null; name: string | null }>> {
  if (!(await hasPermission(context.user, 'asset', 'read'))) return [];
  const { knex } = await createTenantKnex(context.tenant);
  const db = tenantDb(knex, context.tenant);
  const links = await db
    .table('asset_associations')
    .where({ entity_type: 'ticket', entity_id: ticketId })
    .select<Array<{ asset_id: string }>>('asset_id');
  const ids = Array.from(new Set(links.map((l) => l.asset_id)));
  if (ids.length === 0) return [];
  const assets = await db
    .table('assets')
    .whereIn('asset_id', ids)
    .select<Array<{ asset_id: string; asset_tag: string | null; name: string | null; client_id: string | null }>>(
      'asset_id',
      'asset_tag',
      'name',
      'client_id'
    );
  const authContext = await createAssetReadContext(knex, context.tenant, context.user as AssetAuthUser);
  const out: Array<{ assetId: string; assetTag: string | null; name: string | null }> = [];
  for (const a of assets) {
    if (await isAssetReadAllowed(knex, context.tenant, authContext, a)) {
      out.push({ assetId: a.asset_id, assetTag: a.asset_tag ?? null, name: a.name ?? null });
    }
  }
  return out;
}
