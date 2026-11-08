import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { HELD_BY_MSP_STATUS, type Asset, type IAssetCustody, type IAssetCustodyEvent } from '@alga-psa/types';
import type { ReceiveEquipmentInput } from '../schemas/assetCustody.schema';
import { createAssetInTransaction } from '../../actions/assetActions';
import { CustodyError } from './errors';
import { getAssetTypeBySlug } from '../assetTypeRegistry';
import { openCustody } from './openCustody';

/**
 * Ticket intake core (design D4). Runs inside the caller's transaction and owns no permission checks:
 * the wrapper (msp-composition `receiveEquipment`) has already checked asset:create/update, the ticket
 * record check and the asset record check.
 *
 * NEVER writes stock, money or time. It writes assets (new item only), asset_associations,
 * asset_custody, asset_custody_events, asset_history and document associations. It deliberately does not
 * import @alga-psa/inventory or @alga-psa/billing, and does not call `createAssetAssociation`.
 */

export interface ReceiveEquipmentResult {
  asset: Pick<Asset, 'asset_id' | 'asset_tag' | 'name' | 'client_id' | 'asset_type'>;
  createdAsset: boolean;
  custody: IAssetCustody;
  event: IAssetCustodyEvent;
}

const MAX_TAG_ATTEMPTS = 25;

/**
 * `<ticket_number>-EQ<n>`: n is one more than the highest suffix already used for this ticket, then
 * re-checked against every asset tag in the tenant (case-insensitive) and incremented until free.
 *
 * Uniqueness under concurrency comes from the caller holding the ticket row lock (`FOR UPDATE`, taken in
 * `receiveEquipmentForTicket`) for the whole transaction: two receives on one ticket serialise, so the
 * second sees the first's asset. The lock is keyed by tenant, so it is also correct on Citus.
 */
export async function nextEquipmentTag(trx: Knex.Transaction, tenant: string, ticketNumber: string): Promise<string> {
  const prefix = `${ticketNumber}-EQ`;
  const rows = await tenantDb(trx, tenant)
    .table('assets')
    .whereLike('asset_tag', `${prefix.replace(/[\\%_]/g, '\\$&')}%`)
    .select<Array<{ asset_tag: string }>>('asset_tag');
  let max = 0;
  for (const { asset_tag } of rows) {
    const suffix = asset_tag.slice(prefix.length);
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  for (let attempt = 1; attempt <= MAX_TAG_ATTEMPTS; attempt += 1) {
    const candidate = `${prefix}${max + attempt}`;
    const taken = await tenantDb(trx, tenant)
      .table('assets')
      .whereRaw('lower(asset_tag) = lower(?)', [candidate])
      .first('asset_id');
    if (!taken) return candidate;
  }
  throw new CustodyError('tag_generation_failed', 'Could not generate a free equipment tag. Enter a tag manually.');
}

/**
 * An attribute validation error is thrown as JSON with `attributes.<key>` paths. Re-throw it with each issue
 * mapped to the translated "Missing required asset field: {{field}}" key, naming the field by the label from
 * the type's fields_schema, so the dialog never shows an internal path. Anything else is returned unchanged.
 */
async function withAttributeFieldLabels(error: unknown, trx: Knex.Transaction, tenant: string, assetType: string): Promise<unknown> {
  if (!(error instanceof Error) || !error.message.startsWith('{')) return error;
  let parsed: { kind?: string; issues?: Array<{ path?: Array<string | number>; message?: string; code?: string }> };
  try {
    parsed = JSON.parse(error.message);
  } catch {
    return error;
  }
  if (parsed.kind !== 'validation' || !Array.isArray(parsed.issues)) return error;
  const entry = await getAssetTypeBySlug(trx, tenant, assetType).catch(() => null);
  const issues = parsed.issues.map((issue) => {
    if (issue.path?.[0] !== 'attributes') return issue;
    const key = String(issue.path[1] ?? '');
    const label = entry?.fields_schema?.find((f) => f.key === key)?.label;
    return label
      ? {
          ...issue,
          message: `Missing required asset field: ${label}.`,
          params: { messageKey: 'msp/assets:errors.asset.missingFieldNamed', messageParams: { field: label } },
        }
      : issue;
  });
  return new Error(JSON.stringify({ ...parsed, issues }));
}

export async function receiveEquipmentForTicket(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  input: ReceiveEquipmentInput
): Promise<ReceiveEquipmentResult> {
  const db = tenantDb(trx, tenant);
  const ticket = await db
    .table('tickets')
    .where({ ticket_id: input.ticket_id })
    .select('ticket_id', 'ticket_number', 'client_id')
    .forUpdate() // serialises concurrent receives on this ticket (generated tags); tenant-keyed, Citus-safe
    .first();
  if (!ticket) throw new CustodyError('ticket_not_found', 'Ticket not found.');
  if (!ticket.client_id) {
    throw new CustodyError('ticket_has_no_client', 'This ticket has no client. Set a client before receiving equipment.');
  }

  let assetId = input.asset_id;
  let createdAsset = false;
  let assetSummary: ReceiveEquipmentResult['asset'] | null = null;

  if (input.new_asset) {
    const n = input.new_asset;
    const assetTag = n.asset_tag ?? (await nextEquipmentTag(trx, tenant, String(ticket.ticket_number)));
    // Intake creates a lightweight held asset: the dialog has no custom-field inputs, so do not require
    // every custom attribute. Any attributes that are supplied are still schema-validated.
    const created = await createAssetInTransaction(trx, tenant, actorUserId, {
      asset_type: n.asset_type,
      client_id: ticket.client_id,
      asset_tag: assetTag,
      name: n.name,
      status: HELD_BY_MSP_STATUS,
      ownership: 'client',
      serial_number: n.serial_number ?? undefined,
      manufacturer: n.manufacturer,
      model: n.model,
    } as any, { requireCustomAttributes: false }).catch(async (error: unknown) => {
      throw await withAttributeFieldLabels(error, trx, tenant, n.asset_type);
    });
    assetId = created.asset_id;
    createdAsset = true;
    assetSummary = {
      asset_id: created.asset_id,
      asset_tag: created.asset_tag,
      name: created.name,
      client_id: created.client_id,
      asset_type: created.asset_type,
    };
  }

  // openCustody enforces client match, open-episode and location/holder validity.
  const opened = await openCustody(trx, tenant, actorUserId, {
    asset_id: assetId!,
    ticket_id: input.ticket_id,
    purpose: input.purpose,
    location_id: input.location_id,
    bin: input.bin,
    holder_user_id: input.holder_user_id,
    next_action_party: input.next_action_party,
    next_action_note: input.next_action_note,
    follow_up_on: input.follow_up_on,
    condition_note: input.condition_note,
    accessories: input.accessories,
    document_ids: input.document_ids,
    occurred_at: input.occurred_at,
    note: input.note,
  });

  if (opened.event.document_ids.length) {
    await db.table('document_associations').insert(
      opened.event.document_ids.map((document_id) => ({
        tenant, document_id, entity_id: assetId!, entity_type: 'asset',
      }))
    ).onConflict(['tenant', 'document_id', 'entity_id', 'entity_type']).ignore();
  }

  if (!assetSummary) {
    const existing = await db
      .table('assets')
      .where({ asset_id: assetId })
      .select('asset_id', 'asset_tag', 'name', 'client_id', 'asset_type')
      .first();
    assetSummary = existing;
  }

  // Link asset to ticket directly (not via createAssetAssociation: that is a server action with its own auth).
  const already = await db
    .table('asset_associations')
    .where({ asset_id: assetId, entity_type: 'ticket', entity_id: input.ticket_id })
    .first('asset_id');
  if (!already) {
    await db.table('asset_associations').insert({
      tenant,
      asset_id: assetId,
      entity_id: input.ticket_id,
      entity_type: 'ticket',
      relationship_type: 'affected',
      created_by: actorUserId,
      created_at: new Date().toISOString(),
    });
  }

  return { asset: assetSummary!, createdAsset, custody: opened.custody, event: opened.event };
}
