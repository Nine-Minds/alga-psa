import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions';

export interface LowStockNotificationJobData extends Record<string, unknown> {
  tenantId: string;
}

interface LowStockLine {
  location_id: string;
  location_name: string;
  manager_user_id: string | null;
  service_name: string | null;
  sku: string | null;
  available: number;
  reorder_point: number;
}

/**
 * Daily low-stock alert job (remediation plan F037/F038).
 *
 * Finds every (product × location) at or below its effective reorder point
 * (per-location override, else product default) and sends ONE in-app notification
 * per location to that location's manager_user_id. Routing is strictly per-location
 * — a manager only hears about their own location, never a tenant-wide blast.
 * Locations without a manager are skipped and logged in the run summary.
 */
export async function lowStockNotificationHandler(data: LowStockNotificationJobData): Promise<void> {
  const { tenantId } = data;
  if (!tenantId) throw new Error('Tenant ID is required for the low-stock notification job');

  await runWithTenant(tenantId, async () => {
    const knex = await getConnection(tenantId);

    // Same threshold semantics as the inventory package's lowStockReport:
    // effective reorder point = per-location override ?? product default; rows with
    // neither configured are not low-stock.
    const rows = (await knex('stock_levels as sl')
      .join('product_inventory_settings as pis', function () {
        this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
      })
      .join('stock_locations as loc', function () {
        this.on('sl.location_id', '=', 'loc.location_id').andOn('sl.tenant', '=', 'loc.tenant');
      })
      .leftJoin('service_catalog as sc', function () {
        this.on('sl.service_id', '=', 'sc.service_id').andOn('sl.tenant', '=', 'sc.tenant');
      })
      .where({ 'sl.tenant': tenantId, 'pis.track_stock': true, 'loc.is_active': true })
      .whereRaw('COALESCE(sl.reorder_point, pis.reorder_point) IS NOT NULL')
      .whereRaw(
        'sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity <= COALESCE(sl.reorder_point, pis.reorder_point)',
      )
      .select(
        'sl.location_id as location_id',
        'loc.name as location_name',
        'loc.manager_user_id as manager_user_id',
        'sc.service_name as service_name',
        'sc.sku as sku',
        knex.raw('sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity as available'),
        knex.raw('COALESCE(sl.reorder_point, pis.reorder_point) as reorder_point'),
      )) as LowStockLine[];

    if (rows.length === 0) {
      console.log(`[low-stock] tenant ${tenantId}: nothing at or below reorder point`);
      return;
    }

    const byLocation = new Map<string, LowStockLine[]>();
    for (const r of rows) {
      const bucket = byLocation.get(r.location_id) ?? [];
      bucket.push(r);
      byLocation.set(r.location_id, bucket);
    }

    let sent = 0;
    const unmanaged: string[] = [];
    for (const [, lines] of byLocation) {
      const { location_name, manager_user_id } = lines[0];
      if (!manager_user_id) {
        // No firehose fallback (F038): unmanaged locations are only logged.
        unmanaged.push(location_name);
        continue;
      }
      const summary = lines
        .slice(0, 5)
        .map((l) => `${l.service_name || l.sku || 'product'} (${l.available}/${l.reorder_point})`)
        .join(', ');
      const suffix = lines.length > 5 ? ` and ${lines.length - 5} more` : '';
      await createNotificationFromTemplateInternal(knex, {
        tenant: tenantId,
        user_id: manager_user_id,
        template_name: 'inventory-low-stock',
        type: 'warning',
        category: 'inventory',
        link: '/msp/inventory/stock',
        data: {
          locationName: location_name,
          productCount: String(lines.length),
          summary: summary + suffix,
        },
      });
      sent += 1;
    }

    console.log(
      `[low-stock] tenant ${tenantId}: ${sent} notification(s) sent across ${byLocation.size} location(s)` +
        (unmanaged.length ? `; skipped (no manager): ${unmanaged.join(', ')}` : ''),
    );
  });
}
