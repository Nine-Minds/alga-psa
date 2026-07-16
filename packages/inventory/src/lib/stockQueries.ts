import { Knex } from 'knex';
import { IStockLevel, IStockLocation } from '@alga-psa/types';
import { availableQuantity } from './levels';

export interface StockLevelRow extends IStockLevel {
  location_name: string | null;
  available: number;
}

export interface LocationStockRow extends IStockLevel {
  service_name: string | null;
  sku: string | null;
  available: number;
}

export async function queryStockLevelsForProduct(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
): Promise<StockLevelRow[]> {
  const rows = (await trx('stock_levels as sl')
    .leftJoin('stock_locations as loc', function () {
      this.on('sl.location_id', '=', 'loc.location_id').andOn('sl.tenant', '=', 'loc.tenant');
    })
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
    })
    .where({ 'sl.tenant': tenant, 'sl.service_id': serviceId })
    .select(
      'sl.*',
      'loc.name as location_name',
      trx.raw('COALESCE(sl.reorder_point, pis.reorder_point) as reorder_point'),
    )
    .orderBy('loc.name', 'asc')) as Array<IStockLevel & { location_name: string | null }>;
  return rows.map((row) => ({ ...row, available: availableQuantity(row) }));
}

export async function queryStockAtLocation(
  trx: Knex.Transaction,
  tenant: string,
  locationId: string,
): Promise<LocationStockRow[]> {
  const rows = (await trx('stock_levels as sl')
    .leftJoin('service_catalog as sc', function () {
      this.on('sl.service_id', '=', 'sc.service_id').andOn('sl.tenant', '=', 'sc.tenant');
    })
    .where({ 'sl.tenant': tenant, 'sl.location_id': locationId })
    .select('sl.*', 'sc.service_name', 'sc.sku')
    .orderBy('sc.service_name', 'asc')) as Array<
    IStockLevel & { service_name: string | null; sku: string | null }
  >;
  return rows.map((row) => ({ ...row, available: availableQuantity(row) }));
}

export async function queryStockLocations(
  trx: Knex.Transaction,
  tenant: string,
  opts?: { includeInactive?: boolean; includeStock?: boolean },
): Promise<IStockLocation[]> {
  if (!opts?.includeStock) {
    const query = trx('stock_locations').where({ tenant });
    if (!opts?.includeInactive) query.andWhere({ is_active: true });
    return (await query.orderBy('name', 'asc')) as IStockLocation[];
  }

  const levelAgg = trx('stock_levels')
    .select('location_id')
    .countDistinct({ item_type_count: 'service_id' })
    .sum({ on_hand_qty: 'quantity_on_hand' })
    .where({ tenant })
    .andWhere('quantity_on_hand', '>', 0)
    .groupBy('location_id')
    .as('lvl');
  const unitAgg = trx('stock_units')
    .select('location_id')
    .count({ unit_count: '*' })
    .where({ tenant })
    .whereIn('status', ['in_stock', 'allocated', 'in_transit'])
    .groupBy('location_id')
    .as('un');
  const query = trx('stock_locations as loc')
    .leftJoin(levelAgg, 'lvl.location_id', 'loc.location_id')
    .leftJoin(unitAgg, 'un.location_id', 'loc.location_id')
    .where('loc.tenant', tenant);
  if (!opts?.includeInactive) query.andWhere('loc.is_active', true);
  const rows = await query
    .orderBy('loc.name', 'asc')
    .select(
      'loc.*',
      trx.raw('COALESCE(lvl.item_type_count, 0) as item_type_count'),
      trx.raw('COALESCE(lvl.on_hand_qty, 0) as on_hand_qty'),
      trx.raw('COALESCE(un.unit_count, 0) as unit_count'),
    );
  return rows.map((row: any) => ({
    ...row,
    item_type_count: Number(row.item_type_count),
    on_hand_qty: Number(row.on_hand_qty),
    unit_count: Number(row.unit_count),
  })) as IStockLocation[];
}

export async function queryStockLocation(
  trx: Knex.Transaction,
  tenant: string,
  locationId: string,
): Promise<IStockLocation | null> {
  const row = await trx('stock_locations').where({ tenant, location_id: locationId }).first();
  return (row ?? null) as IStockLocation | null;
}
