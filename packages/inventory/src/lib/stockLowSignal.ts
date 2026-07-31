import type { Knex } from 'knex';

export interface PendingStockLowSignal {
  tenant: string;
  service_id: string;
  service_name: string;
  sku: string | null;
  location_id: string;
  location_name: string;
  on_hand: number;
  reorder_point: number;
}

interface StockLowSignalRow {
  service_id: string;
  service_name: string;
  sku: string | null;
  location_id: string;
  location_name: string;
  quantity_on_hand: string | number | null;
  reorder_point: string | number | null;
  track_stock: boolean;
  is_serialized: boolean;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function collectStockLowSignalAfterConsume(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  locationId: string,
  consumedQuantity: number,
): Promise<PendingStockLowSignal | null> {
  const consumed = Number(consumedQuantity);
  if (!Number.isFinite(consumed) || consumed <= 0) return null;

  const row = await trx<StockLowSignalRow>('stock_levels as sl')
    .join('product_inventory_settings as pis', function () {
      this.on('pis.tenant', '=', 'sl.tenant').andOn('pis.service_id', '=', 'sl.service_id');
    })
    .join('stock_locations as loc', function () {
      this.on('loc.tenant', '=', 'sl.tenant').andOn('loc.location_id', '=', 'sl.location_id');
    })
    .join('service_catalog as sc', function () {
      this.on('sc.tenant', '=', 'sl.tenant').andOn('sc.service_id', '=', 'sl.service_id');
    })
    .where({ 'sl.tenant': tenant, 'sl.service_id': serviceId, 'sl.location_id': locationId })
    .select(
      'sl.service_id',
      'sc.service_name',
      'sc.sku',
      'sl.location_id',
      'loc.name as location_name',
      'sl.quantity_on_hand',
      'pis.track_stock',
      'pis.is_serialized',
      trx.raw('COALESCE(sl.reorder_point, pis.reorder_point) as reorder_point'),
    )
    .first();

  if (!row || !row.track_stock || row.is_serialized) return null;

  const onHand = toNumber(row.quantity_on_hand);
  const reorderPoint = toNumber(row.reorder_point);
  if (onHand === null || reorderPoint === null) return null;

  const previousOnHand = onHand + consumed;
  if (!(previousOnHand > reorderPoint && onHand <= reorderPoint)) return null;

  return {
    tenant,
    service_id: row.service_id,
    service_name: row.service_name,
    sku: row.sku,
    location_id: row.location_id,
    location_name: row.location_name,
    on_hand: onHand,
    reorder_point: reorderPoint,
  };
}

export async function collectDefaultLocationStockLowSignalAfterConsume(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  consumedQuantity: number,
): Promise<PendingStockLowSignal | null> {
  const settings = await trx('product_inventory_settings')
    .where({ tenant, service_id: serviceId })
    .select('default_location_id')
    .first();

  let locationId = settings?.default_location_id ?? null;
  if (!locationId) {
    const location = await trx('stock_locations')
      .where({ tenant, is_default: true })
      .select('location_id')
      .first();
    locationId = location?.location_id ?? null;
  }

  if (!locationId) return null;

  return collectStockLowSignalAfterConsume(trx, tenant, serviceId, locationId, consumedQuantity);
}
