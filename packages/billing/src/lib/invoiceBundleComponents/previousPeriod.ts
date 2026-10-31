import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { InvoiceBundlePresentation } from '@alga-psa/types';
import type { BundlePreviousPeriod } from './snapshot';

export interface PreviousPeriodRequest {
  /** `contract_lines.contract_line_id` of the Fixed line. */
  contractLineId: string;
  /** Earliest service period start covered by this invoice's bundle. */
  earliestPeriodStart: string | Date;
}

export interface PreviousPeriodRow {
  contractLineId: string;
  serviceId: string;
  serviceName: string;
  itemDetailId: string;
  detailQuantity: number | null;
  servicePeriodStart: string | Date | null;
  servicePeriodEnd: string | Date | null;
  bundlePresentation: InvoiceBundlePresentation | null;
}

const toMs = (value: string | Date | null | undefined): number => {
  if (!value) return Number.NaN;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
};

/**
 * Pure selection of "the previous billed period" per line from candidate rows
 * (rows of other, non-cancelled invoices). The latest service period ending on
 * or before the bundle's earliest covered start wins; quantities are summed per
 * service, preferring the prior invoice's snapshot quantity (raw, unclamped)
 * over the clamped detail quantity.
 */
export function selectPreviousPeriods(
  requests: PreviousPeriodRequest[],
  rows: PreviousPeriodRow[],
): Map<string, BundlePreviousPeriod | null> {
  const result = new Map<string, BundlePreviousPeriod | null>();
  for (const request of requests) {
    const startMs = toMs(request.earliestPeriodStart);
    const candidates = rows.filter((row) => {
      if (row.contractLineId !== request.contractLineId) return false;
      const endMs = toMs(row.servicePeriodEnd);
      return !Number.isNaN(endMs) && !Number.isNaN(startMs) && endMs <= startMs;
    });
    if (candidates.length === 0) {
      result.set(request.contractLineId, null);
      continue;
    }
    const latest = candidates.reduce((best, row) => {
      const endDelta = toMs(row.servicePeriodEnd) - toMs(best.servicePeriodEnd);
      if (endDelta !== 0) return endDelta > 0 ? row : best;
      return toMs(row.servicePeriodStart) > toMs(best.servicePeriodStart) ? row : best;
    });
    const sameperiod = candidates.filter(
      (row) =>
        toMs(row.servicePeriodEnd) === toMs(latest.servicePeriodEnd)
        && toMs(row.servicePeriodStart) === toMs(latest.servicePeriodStart),
    );

    const quantities = new Map<string, number | null>();
    const names = new Map<string, string>();
    const countedSnapshotComponents = new Set<object>();
    const add = (serviceId: string, quantity: number | null) => {
      if (!quantities.has(serviceId)) {
        quantities.set(serviceId, quantity);
      } else {
        const existing = quantities.get(serviceId);
        quantities.set(serviceId, existing === null || quantity === null ? null : (existing ?? 0) + quantity);
      }
    };
    for (const row of sameperiod) {
      names.set(row.serviceId, row.serviceName);
      const component = row.bundlePresentation?.components?.find((entry) => entry.detailItemIds.includes(row.itemDetailId));
      if (component) {
        if (countedSnapshotComponents.has(component)) continue;
        countedSnapshotComponents.add(component);
        // Snapshot null means the quantity was unset; fall back to the detail row.
        add(row.serviceId, component.quantity ?? row.detailQuantity);
      } else {
        add(row.serviceId, row.detailQuantity);
      }
    }
    result.set(request.contractLineId, { quantitiesByServiceId: quantities, serviceNames: names });
  }
  return result;
}

/**
 * One batched, tenant-scoped query for every bundle on an invoice. Cancelled
 * invoices and the invoice being generated are ignored: invoice detail rows
 * are the only quantity history, because allocated services are edited in place.
 */
export async function loadPreviousBundlePeriods(
  trx: Knex | Knex.Transaction,
  tenant: string,
  currentInvoiceId: string,
  requests: PreviousPeriodRequest[],
): Promise<Map<string, BundlePreviousPeriod | null>> {
  if (requests.length === 0) return new Map();
  const latestStart = requests.reduce((max, request) => {
    const ms = toMs(request.earliestPeriodStart);
    return ms > max ? ms : max;
  }, Number.NEGATIVE_INFINITY);

  const db = tenantDb(trx, tenant);
  const query = db.table('invoice_charge_details as d');
  db.tenantJoin(query, 'invoice_charges as c', 'd.item_id', 'c.item_id');
  db.tenantJoin(query, 'invoices as i', 'c.invoice_id', 'i.invoice_id');
  db.tenantJoin(query, 'contract_line_service_configuration as cfg', 'd.config_id', 'cfg.config_id');
  db.tenantJoin(query, 'service_catalog as sc', 'd.service_id', 'sc.service_id');
  const rows = await query
    .whereIn('cfg.contract_line_id', requests.map((request) => request.contractLineId))
    .whereNot('i.invoice_id', currentInvoiceId)
    .whereNot('i.status', 'cancelled')
    .whereNotNull('d.service_period_end')
    .where('d.service_period_end', '<=', new Date(latestStart))
    .select(
      'cfg.contract_line_id as contractLineId',
      'd.service_id as serviceId',
      'sc.service_name as serviceName',
      'd.item_detail_id as itemDetailId',
      'd.quantity as detailQuantity',
      'd.service_period_start as servicePeriodStart',
      'd.service_period_end as servicePeriodEnd',
      'c.bundle_presentation as bundlePresentation',
    );

  return selectPreviousPeriods(
    requests,
    rows.map((row: any) => ({
      ...row,
      detailQuantity: row.detailQuantity === null || row.detailQuantity === undefined ? null : Number(row.detailQuantity),
      bundlePresentation: typeof row.bundlePresentation === 'string' ? JSON.parse(row.bundlePresentation) : row.bundlePresentation ?? null,
    })),
  );
}
