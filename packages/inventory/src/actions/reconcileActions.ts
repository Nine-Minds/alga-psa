'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { reconcileStockLevels } from '../lib';

// NOTE: 'use server' file — export ONLY async functions (+ erased types).

export interface StockCacheCorrection {
  service_id: string;
  location_id: string;
  field: 'quantity_on_hand' | 'reserved_quantity' | 'held_quantity';
  from: number;
  to: number;
}

export interface RebuildStockCachesResult {
  products_checked: number;
  corrections: StockCacheCorrection[];
}

/**
 * Rebuild the stock_levels cache for every stock-tracked product from the sources of
 * truth (movement ledger / unit statuses / open SO reservations) and report exactly
 * what was corrected (F028). This is the production repair path for cache drift —
 * before it existed, a drifted reserved/held counter was permanently stuck.
 */
export const rebuildStockCaches = withAuth(
  async (user, { tenant }): Promise<RebuildStockCachesResult> => {
    if (!(await hasPermission(user, 'inventory', 'update'))) {
      throw new Error('Permission denied: inventory update required');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const products = (await trx('product_inventory_settings')
        .where({ tenant, track_stock: true })
        .select('service_id', 'is_serialized')) as Array<{ service_id: string; is_serialized: boolean }>;

      const corrections: StockCacheCorrection[] = [];
      for (const p of products) {
        const before = (await trx('stock_levels')
          .where({ tenant, service_id: p.service_id })
          .select('location_id', 'quantity_on_hand', 'reserved_quantity', 'held_quantity')) as Array<{
          location_id: string;
          quantity_on_hand: number;
          reserved_quantity: number;
          held_quantity: number;
        }>;
        const beforeByLocation = new Map(before.map((r) => [r.location_id, r]));

        const after = await reconcileStockLevels(trx, tenant, p.service_id, Boolean(p.is_serialized));

        for (const level of after) {
          const prev = beforeByLocation.get(level.location_id);
          const fields = ['quantity_on_hand', 'reserved_quantity', 'held_quantity'] as const;
          for (const field of fields) {
            const from = Number(prev?.[field] ?? 0);
            const to = level[field];
            if (from !== to) {
              corrections.push({ service_id: p.service_id, location_id: level.location_id, field, from, to });
            }
          }
        }
      }

      return { products_checked: products.length, corrections };
    });
  },
);
