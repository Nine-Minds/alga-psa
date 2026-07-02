import { Knex } from 'knex';
import type { ProductAvailability, ProductLocationAvailability } from './integrationTypes';

/** Core of getProductAvailability (F005) — action wrapper adds auth/permission. */
export async function queryProductAvailability(
  trx: Knex.Transaction,
  tenant: string,
  serviceIds: string[],
): Promise<ProductAvailability[]> {
  const ids = [...new Set((serviceIds ?? []).filter(Boolean))];
  if (!ids.length) return [];

  const settingsRows = await trx('product_inventory_settings')
    .where({ tenant })
    .whereIn('service_id', ids)
    .select('service_id', 'track_stock', 'is_serialized', 'reorder_point');
  const settingsById = new Map(settingsRows.map((s: any) => [s.service_id, s]));

  const levelRows = await trx('stock_levels as sl')
    .join('stock_locations as loc', function () {
      this.on('loc.location_id', '=', 'sl.location_id').andOn('loc.tenant', '=', 'sl.tenant');
    })
    .where({ 'sl.tenant': tenant })
    .whereIn('sl.service_id', ids)
    .select(
      'sl.service_id',
      'sl.location_id',
      'loc.name as location_name',
      'sl.quantity_on_hand',
      'sl.reserved_quantity',
      'sl.held_quantity',
    );

  return ids.map((serviceId) => {
    const settings: any = settingsById.get(serviceId);
    const tracked = !!settings?.track_stock;
    const rows = levelRows.filter((r: any) => r.service_id === serviceId);

    let onHand = 0;
    let available = 0;
    const locations: ProductLocationAvailability[] = [];
    for (const r of rows as any[]) {
      const qty = Number(r.quantity_on_hand ?? 0);
      onHand += qty;
      available += qty - Number(r.reserved_quantity ?? 0) - Number(r.held_quantity ?? 0);
      if (qty !== 0) {
        locations.push({
          location_id: r.location_id,
          location_name: r.location_name,
          on_hand: qty,
        });
      }
    }
    locations.sort((a, b) => b.on_hand - a.on_hand);

    return {
      service_id: serviceId,
      track_stock: tracked,
      is_serialized: !!settings?.is_serialized,
      on_hand_total: tracked ? onHand : 0,
      available_total: tracked ? available : 0,
      reorder_point: settings?.reorder_point ?? null,
      locations: tracked ? locations : [],
    };
  });
}
