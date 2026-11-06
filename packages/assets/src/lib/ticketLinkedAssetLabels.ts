import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { LabelLinkedAssetInfo, LabelRequestContext } from '@alga-psa/types';

import { createAssetReadContext, isAssetReadAllowed } from './assetReadAuthorization';
import { getOpenCustodyForAssets } from './custody/queries';
import { formatCustodyForLabel, formatCustodyForLabelSubject, type CustodyLabelFacts } from './custody/labelFormat';
import { getLinkedAssetInfoForAssets, type FormatCpuCoreCount, type LinkedAssetInfoBase } from './linkedAssetLabelInfo';

/**
 * The asset half of a ticket work tag: the linked asset's tag and a serial suffix. Read-only.
 * A Letter worksheet may also receive the full serial of the same authorized asset.
 *
 * Lives in the assets package because the asset kernel check must run here (tickets never import
 * assets; the composition root merges this into the ticket view models). An asset the caller cannot
 * read never contributes.
 */

export interface TicketLinkedAssetLabelParts {
  assetId: string;
  assetTag: string | null;
  serialSuffix: string | null;
  /** Present only when the resolved template explicitly requests Letter worksheet details. */
  assetSerialNumber?: string | null;
  /** Held-equipment line ("Main Office / Shelf B3", "With vendor", "2 items held"), or null. Never the note. */
  custodyLocation: string | null;
  /** "Waiting on vendor, Oct 29" etc., or null. Derived from party + follow-up date only. */
  nextAction: string | null;
  /**
   * Full identification of the asset this label is about (name, Make/Model, OS, CPU, RAM, Storage) for
   * the full-page customer worksheet. Null when the label has no asset (custody-only labels) or the
   * asset row is missing. Never filled for an asset the caller cannot read.
   */
  linkedAssetInfo: LabelLinkedAssetInfo | null;
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

export interface TicketLabelSubject {
  recordId: string;
  /** The item this label is about. Ignored when not linked to the ticket or not readable (treated as no pick). */
  linkedAssetId?: string;
}

/**
 * One entry per subject, in request order. The same ticket may appear in several subjects with different picks.
 *
 * Asset line: the subject's picked asset when it is linked to the ticket AND readable, else the single readable
 * linked asset, else none. Custody line: `formatCustodyForLabelSubject` - a valid pick decides (its own custody,
 * or nothing when it is not held); with no pick, the held items on the ticket are summarised.
 * Links, assets and custody are read once per request.
 */
export async function getTicketLinkedAssetLabelParts(
  context: LabelRequestContext,
  subjects: ReadonlyArray<TicketLabelSubject>,
  options: { formatCpuCoreCount?: FormatCpuCoreCount } = {}
): Promise<Array<TicketLinkedAssetLabelParts | null>> {
  const result: Array<TicketLinkedAssetLabelParts | null> = subjects.map(() => null);
  const ticketIds = Array.from(new Set(subjects.map((s) => s.recordId)));
  if (ticketIds.length === 0 || !(await hasPermission(context.user, 'asset', 'read'))) {
    return result;
  }

  const { knex } = await createTenantKnex(context.tenant);
  const db = tenantDb(knex, context.tenant);
  const links = await db
    .table('asset_associations')
    .where({ entity_type: 'ticket' })
    .whereIn('entity_id', ticketIds)
    .select<Array<{ asset_id: string; entity_id: string }>>('asset_id', 'entity_id');
  if (links.length === 0) {
    return result;
  }

  const assetIds = Array.from(new Set(links.map((l) => l.asset_id)));
  const assets = await db
    .table('assets')
    .whereIn('asset_id', assetIds)
    .select<
      Array<{
        asset_id: string;
        asset_tag: string | null;
        serial_number: string | null;
        client_id: string | null;
        asset_type: string | null;
        name: string | null;
        manufacturer: string | null;
        model: string | null;
      }>
    >('asset_id', 'asset_tag', 'serial_number', 'client_id', 'asset_type', 'name', 'manufacturer', 'model');
  const byId = new Map(assets.map((a) => [a.asset_id, a]));

  const authContext = await createAssetReadContext(knex, context.tenant, context.user);
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

  const readableByTicket = new Map<string, string[]>();
  for (const ticketId of ticketIds) {
    const linked = Array.from(new Set(links.filter((l) => l.entity_id === ticketId).map((l) => l.asset_id)));
    const readableLinked: string[] = [];
    for (const assetId of linked) {
      if (await canRead(assetId)) readableLinked.push(assetId);
    }
    readableByTicket.set(ticketId, readableLinked);
  }
  const factsOf = (assetId: string): CustodyLabelFacts | null => formatCustodyForLabel(custodyByAsset.get(assetId));

  const resolved: Array<string | null> = [];
  subjects.forEach((subject, index) => {
    const readableLinked = readableByTicket.get(subject.recordId) ?? [];
    const pickedId = subject.linkedAssetId && readableLinked.includes(subject.linkedAssetId) ? subject.linkedAssetId : null;
    const assetId = pickedId ?? (readableLinked.length === 1 ? readableLinked[0] : null);
    resolved[index] = assetId;
    const held = readableLinked.flatMap((id) => {
      const facts = factsOf(id);
      return facts ? [facts] : [];
    });
    const custody = formatCustodyForLabelSubject(held, pickedId ? { facts: factsOf(pickedId) } : null);
    if (!assetId && !custody) return;
    const asset = assetId ? byId.get(assetId)! : null;
    result[index] = {
      assetId: assetId ?? '',
      assetTag: asset?.asset_tag ?? null,
      serialSuffix: asset ? serialSuffixOf(asset.serial_number) : null,
      ...(context.includeWorksheetDetails
        ? { assetSerialNumber: asset?.serial_number?.trim() || null }
        : {}),
      custodyLocation: custody?.custodyLocation ?? null,
      nextAction: custody?.nextAction ?? null,
      linkedAssetInfo: null,
    };
  });

  // The worksheet block is fetched only for the assets the labels actually resolved — always readable.
  const infoIds = Array.from(new Set(resolved.filter((id): id is string => Boolean(id))));
  if (infoIds.length > 0) {
    const bases: LinkedAssetInfoBase[] = infoIds.flatMap((id) => {
      const a = byId.get(id);
      if (!a) return [];
      return [{ asset_id: a.asset_id, asset_type: a.asset_type, name: a.name, manufacturer: a.manufacturer, model: a.model }];
    });
    const infoById = await getLinkedAssetInfoForAssets(knex, context.tenant, bases, options.formatCpuCoreCount);
    result.forEach((parts, index) => {
      const assetId = resolved[index];
      if (!parts || !assetId) return;
      parts.linkedAssetInfo = infoById.get(assetId) ?? null;
    });
  }
  return result;
}

export interface TicketLinkedAssetChoice {
  assetId: string;
  assetTag: string | null;
  name: string | null;
  /** The item's open-custody facts as the tag would print them; null = not in open custody (cannot be batch-printed). */
  custody: CustodyLabelFacts | null;
}

/**
 * The readable assets linked to ONE ticket, for the single-print dialog's picker: tag, name and the custody
 * facts the tag would print (so the dialog can count held items and preview without a second call).
 */
export async function listTicketLinkedAssetChoices(
  context: LabelRequestContext,
  ticketId: string
): Promise<TicketLinkedAssetChoice[]> {
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
  const authContext = await createAssetReadContext(knex, context.tenant, context.user);
  const readable: typeof assets = [];
  for (const a of assets) {
    if (await isAssetReadAllowed(knex, context.tenant, authContext, a)) readable.push(a);
  }
  const custodyByAsset = await getOpenCustodyForAssets(knex, context.tenant, readable.map((a) => a.asset_id));
  return readable.map((a) => ({
    assetId: a.asset_id,
    assetTag: a.asset_tag ?? null,
    name: a.name ?? null,
    custody: formatCustodyForLabel(custodyByAsset.get(a.asset_id)),
  }));
}
