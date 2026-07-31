'use server';

import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';

/**
 * Inventory provenance for a managed asset (F024/F025).
 *
 * Assets cannot import @alga-psa/inventory (inventory already imports
 * @alga-psa/assets/actions in lib/assetLink.ts — importing back forms a cycle), so
 * this reads the inventory tables directly. The result types mirror
 * AssetInventoryProvenance in @alga-psa/inventory/lib/integrationTypes.
 */

export interface AssetRmaHistoryRow {
  rma_id: string;
  rma_number: string | null;
  status: string;
  created_at: string; // ISO
  resolution: string | null;
}

export interface AssetInventoryProvenance {
  /** null when the asset has no inventory links */
  service_id: string | null;
  service_name: string | null;
  sku: string | null;
  unit_id: string | null;
  serial_number: string | null;
  mac_address: string | null;
  /** origin sales order, via unit → fulfillment consume → SO; null for e.g. ticket-material installs */
  origin_so_id: string | null;
  origin_so_number: string | null;
  delivered_at: string | null; // ISO
  rma_history: AssetRmaHistoryRow[];
}

const toIso = (value: unknown): string | null =>
  value ? new Date(value as string | number | Date).toISOString() : null;

const EMPTY_PROVENANCE: AssetInventoryProvenance = {
  service_id: null,
  service_name: null,
  sku: null,
  unit_id: null,
  serial_number: null,
  mac_address: null,
  origin_so_id: null,
  origin_so_number: null,
  delivered_at: null,
  rma_history: [],
};

/**
 * Product/SKU, the delivered serial unit, its origin sales order, and RMA history
 * for a managed asset. Returns an all-null shape (no links) when the asset carries
 * neither a service_id nor a stock_unit_id. Requires asset:read.
 */
export const getAssetInventoryProvenance = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<AssetInventoryProvenance> => {
  if (!(await hasPermission(user, 'asset', 'read'))) return { ...EMPTY_PROVENANCE };
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const asset = await trx('assets')
      .where({ tenant, asset_id: assetId })
      .select('service_id', 'stock_unit_id')
      .first();
    if (!asset || (!asset.service_id && !asset.stock_unit_id)) {
      return { ...EMPTY_PROVENANCE };
    }

    const unit = asset.stock_unit_id
      ? await trx('stock_units')
          .where({ tenant, unit_id: asset.stock_unit_id })
          .select('unit_id', 'service_id', 'serial_number', 'mac_address', 'delivered_at')
          .first()
      : null;

    const serviceId: string | null = asset.service_id ?? unit?.service_id ?? null;

    let serviceName: string | null = null;
    let sku: string | null = null;
    if (serviceId) {
      const svc = await trx('service_catalog')
        .where({ tenant, service_id: serviceId })
        .select('service_name', 'sku')
        .first();
      serviceName = svc?.service_name ?? null;
      sku = svc?.sku ?? null;
    }

    // Origin SO: the sales-order consume movement for this unit carries the SO id
    // in source_doc_id (fulfillment clears allocated_so_line_id, so the movement
    // ledger — not the unit row — is the durable backlink).
    let originSoId: string | null = null;
    let originSoNumber: string | null = null;
    if (unit?.unit_id) {
      const movement = await trx('stock_movements')
        .where({
          tenant,
          unit_id: unit.unit_id,
          movement_type: 'consume',
          source_doc_type: 'sales_order',
        })
        .whereNotNull('source_doc_id')
        .orderBy('created_at', 'asc')
        .select('source_doc_id')
        .first();
      if (movement?.source_doc_id) {
        const so = await trx('sales_orders')
          .where({ tenant, so_id: movement.source_doc_id })
          .select('so_id', 'so_number')
          .first();
        if (so) {
          originSoId = so.so_id;
          originSoNumber = so.so_number;
        }
      }
    }

    // RMA history: any case tied to this asset or its returned unit, newest first.
    const rmaRows = await trx('rma_cases')
      .where({ tenant })
      .andWhere((qb) => {
        qb.where({ asset_id: assetId });
        if (unit?.unit_id) qb.orWhere({ returned_unit_id: unit.unit_id });
      })
      .select('rma_id', 'rma_reference', 'status', 'created_at')
      .orderBy('created_at', 'desc');

    const rma_history: AssetRmaHistoryRow[] = rmaRows.map((r: any) => ({
      rma_id: r.rma_id,
      rma_number: r.rma_reference ?? null,
      status: r.status,
      created_at: toIso(r.created_at) ?? new Date(0).toISOString(),
      // rma_cases has no dedicated resolution column; the status conveys the outcome.
      resolution: null,
    }));

    return {
      service_id: serviceId,
      service_name: serviceName,
      sku,
      unit_id: unit?.unit_id ?? null,
      serial_number: unit?.serial_number ?? null,
      mac_address: unit?.mac_address ?? null,
      origin_so_id: originSoId,
      origin_so_number: originSoNumber,
      delivered_at: toIso(unit?.delivered_at),
      rma_history,
    };
  });
});
