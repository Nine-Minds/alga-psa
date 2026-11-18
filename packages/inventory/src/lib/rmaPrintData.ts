import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { serialSuffixOf } from '@alga-psa/assets/lib/ticketLinkedAssetLabels';
import {
  recordUrl,
  type IRmaCase,
  type LabelViewModel,
  type RmaReturnSlipViewModel,
} from '@alga-psa/types';
import { rmaCaseQuery } from './rmaCaseQuery';
import { filterReadableRmaCases, resolveRmaReadScope } from './rma/rmaReadAccess';

/**
 * Print data for one RMA: the RMA work tag (a `LabelViewModel`) and the return slip
 * (`RmaReturnSlipViewModel`). Everything here is READ-ONLY - no rma_events, asset_history, custody or stock
 * row is written by a render or a download.
 *
 * A QR code is not a secret, so the gate is the same one the RMA list uses: `warranty:read` OR
 * `inventory:read` (a warranty-only caller sees client-asset claims only), then the asset record-level read
 * check on every case that references an asset. A missing case and an unreadable case are both `null`.
 */

export interface RmaPrintContext {
  tenant: string;
  user: any;
}

/** The cases the caller may read, one entry per requested id in the same order; `null` = missing or unreadable. */
export async function loadReadableRmaCases(
  context: RmaPrintContext,
  ids: readonly string[]
): Promise<Array<IRmaCase | null>> {
  if (ids.length === 0) return [];
  const scope = await resolveRmaReadScope(context.user);
  if (!scope.allowed) return ids.map(() => null);
  const { knex } = await createTenantKnex(context.tenant);
  const readable = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const rows = (await rmaCaseQuery(trx, context.tenant).whereIn('r.rma_id', [...ids])) as IRmaCase[];
    return filterReadableRmaCases(trx, context.tenant, context.user, rows, scope);
  });
  const byId = new Map(readable.map((row) => [row.rma_id, row]));
  return ids.map((id) => byId.get(id) ?? null);
}

/** `in_progress` -> `In progress`. The tag is a printed English snapshot, like the other label classes. */
export function rmaStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  const spaced = status.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : null;
}

const leg = (carrier: string | null | undefined, tracking: string | null | undefined): string | null => {
  const text = [carrier, tracking].map((part) => (part ?? '').trim()).filter(Boolean).join(' ');
  return text || null;
};

/** The leg that matters on the bench: inbound once the vendor has shipped back, otherwise outbound. */
export function latestShipping(row: IRmaCase): string | null {
  return leg(row.inbound_carrier, row.inbound_tracking_number) ?? leg(row.outbound_carrier, row.outbound_tracking_number);
}

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/** The RMA work tag fields for one readable case. Works for client-asset claims and stock-unit RMAs alike. */
export function buildRmaLabelViewModel(row: IRmaCase, baseUrl: string): LabelViewModel {
  const hasAsset = Boolean(row.asset_id);
  const vendorLine = [row.vendor_name, row.rma_reference ? `Ref ${row.rma_reference}` : null]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  const serial = hasAsset ? row.asset_serial_number : row.returned_serial_number;
  return {
    labelClass: 'rma-work-tag',
    entityType: 'rma',
    recordId: row.rma_id,
    url: recordUrl('rma', row.rma_id, baseUrl),
    identifier: row.rma_number || row.rma_id,
    code128Value: row.rma_number && PRINTABLE_ASCII.test(row.rma_number) ? row.rma_number : null,
    title: (hasAsset ? row.asset_name : row.service_name) ?? null,
    clientName: row.client_name ?? null,
    detail: vendorLine || null,
    secondaryIdentifier: hasAsset ? row.asset_tag ?? null : null,
    serialSuffix: serialSuffixOf(serial),
    rma: {
      statusLabel: rmaStatusLabel(row.status),
      returnBy: row.return_by ?? null,
      shipping: latestShipping(row),
      ticketNumber: row.ticket_number ?? null,
    },
  };
}

/** The return slip for one readable case. `today` is injectable for tests; it is the print date. */
export function buildRmaReturnSlipViewModel(
  row: IRmaCase,
  baseUrl: string,
  today: Date = new Date()
): RmaReturnSlipViewModel {
  const hasAsset = Boolean(row.asset_id);
  const outbound = leg(row.outbound_carrier, row.outbound_tracking_number);
  const inbound = leg(row.inbound_carrier, row.inbound_tracking_number);
  const shippingSummary =
    outbound && inbound ? `Out: ${outbound} / In: ${inbound}` : outbound ?? inbound ?? null;
  return {
    rma: {
      number: row.rma_number || row.rma_id,
      statusLabel: rmaStatusLabel(row.status) ?? '',
      recordUrl: recordUrl('rma', row.rma_id, baseUrl),
      returnBy: row.return_by ?? null,
      returnShipTo: row.return_ship_to ?? null,
      vendorName: row.vendor_name ?? null,
      vendorReference: row.rma_reference ?? null,
      outboundShipping: outbound,
      inboundShipping: inbound,
      shippingSummary,
      ticketNumber: row.ticket_number ?? null,
      printedOn: today.toISOString().slice(0, 10),
    },
    client: { name: row.client_name ?? null },
    asset: {
      name: (hasAsset ? row.asset_name : row.service_name) ?? null,
      serialNumber: (hasAsset ? row.asset_serial_number : row.returned_serial_number) ?? null,
      tag: hasAsset ? row.asset_tag ?? null : null,
      replacementSerialNumber: row.replacement_serial_number ?? null,
    },
  };
}
