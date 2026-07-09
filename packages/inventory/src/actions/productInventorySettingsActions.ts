'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IProductInventorySettings, KitPricingMode } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type ProductInventorySettingsActionError = ActionMessageError | ActionPermissionError;

function productInventorySettingsActionErrorFrom(error: unknown): ProductInventorySettingsActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Service not found':
        return actionError('Product not found. It may have been updated or deleted. Please refresh and try again.');
      case 'Inventory can only be enabled on products (item_kind=product)':
        return actionError('Inventory can only be enabled on products.');
      case 'Inventory not enabled for this product':
        return actionError('Inventory settings are not enabled for this product. Enable inventory tracking first.');
      case 'Cannot disable serialization while serialized units exist for this product':
        return actionError('This product has serialized units. Move, retire, or remove those units before disabling serialization.');
      case 'Cannot clear the kit flag while the kit still has components; remove components first':
        return actionError('Remove all kit components before clearing the kit flag.');
      default:
        if (error.message.startsWith('Invalid kit_pricing_mode:')) {
          return actionError('Choose a valid kit pricing mode.');
        }
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected inventory records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('Inventory settings already exist for this product. Please refresh and try again.');
  }

  return null;
}

async function withProductInventorySettingsActionErrors<T>(
  work: () => Promise<T>,
): Promise<T | ProductInventorySettingsActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = productInventorySettingsActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

/** Assert the service row exists and is a product; return its cost_currency. */
async function assertProduct(trx: Knex.Transaction, tenant: string, serviceId: string): Promise<{ cost_currency: string | null }> {
  const svc = await trx('service_catalog')
    .where({ tenant, service_id: serviceId })
    .select('item_kind', 'cost_currency')
    .first();
  if (!svc) throw new Error('Service not found');
  if (svc.item_kind !== 'product') throw new Error('Inventory can only be enabled on products (item_kind=product)');
  return { cost_currency: svc.cost_currency ?? null };
}

export const getProductInventorySettings = withAuth(
  async (user, { tenant }, serviceId: string): Promise<IProductInventorySettings | null | ProductInventorySettingsActionError> => {
    return withProductInventorySettingsActionErrors(async () => {
      await requireInvPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const row = await trx('product_inventory_settings').where({ tenant, service_id: serviceId }).first();
        return (row ?? null) as IProductInventorySettings | null;
      });
    });
  },
);

/** List products that are inventory-managed, merged with catalog name/sku. */
export const listInventoryProducts = withAuth(async (user, { tenant }): Promise<any[] | ProductInventorySettingsActionError> => {
  return withProductInventorySettingsActionErrors(async () => {
    await requireInvPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Per-product stock totals summed across all locations, so the Stock grid can
      // show on-hand/available without a per-row drill-in.
      const levels = trx('stock_levels')
        .where({ tenant })
        .groupBy('service_id')
        .select('service_id')
        .select(trx.raw('SUM(quantity_on_hand) as on_hand'))
        .select(trx.raw('SUM(quantity_on_hand - reserved_quantity - held_quantity) as available'))
        .as('lv');

      // Per-product reorder status, computed per location with the same effective
      // threshold as lowStockReport / the dashboard: COALESCE(level override, product
      // default), flagged when available <= threshold. A product is "out" if any
      // tracked location is at/below 0, else "low" if any location is at/below reorder.
      const REORDER = 'COALESCE(sl.reorder_point, p2.reorder_point)';
      const AVAIL = '(sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity)';
      const status = trx('stock_levels as sl')
        .join('product_inventory_settings as p2', function () {
          this.on('sl.service_id', '=', 'p2.service_id').andOn('sl.tenant', '=', 'p2.tenant');
        })
        .where({ 'sl.tenant': tenant, 'p2.track_stock': true })
        .groupBy('sl.service_id')
        .select('sl.service_id')
        .select(trx.raw(`bool_or(${REORDER} IS NOT NULL AND ${AVAIL} <= ${REORDER}) as needs_reorder`))
        .select(trx.raw(`bool_or(${REORDER} IS NOT NULL AND ${AVAIL} <= 0) as any_out`))
        .select(trx.raw(`count(*) FILTER (WHERE ${REORDER} IS NOT NULL AND ${AVAIL} <= 0) as out_locations`))
        .select(trx.raw(`count(*) FILTER (WHERE ${REORDER} IS NOT NULL AND ${AVAIL} > 0 AND ${AVAIL} <= ${REORDER}) as low_locations`))
        .as('st');

      return trx('product_inventory_settings as pis')
        .join('service_catalog as sc', function () {
          this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
        })
        .leftJoin(levels, 'lv.service_id', 'pis.service_id')
        .leftJoin(status, 'st.service_id', 'pis.service_id')
        .where({ 'pis.tenant': tenant })
        .select(
          'pis.*',
          'sc.service_name',
          'sc.sku',
          trx.raw('COALESCE(lv.on_hand, 0)::int as on_hand'),
          trx.raw('COALESCE(lv.available, 0)::int as available'),
          trx.raw('COALESCE(st.needs_reorder, false) as needs_reorder'),
          trx.raw('COALESCE(st.any_out, false) as any_out'),
          trx.raw('COALESCE(st.out_locations, 0)::int as out_locations'),
          trx.raw('COALESCE(st.low_locations, 0)::int as low_locations'),
        )
        .orderBy('sc.service_name', 'asc');
    });
  });
});

export const enableInventory = withAuth(
  async (
    user,
    { tenant },
    serviceId: string,
    input?: {
      is_serialized?: boolean;
      is_kit?: boolean;
      creates_asset_on_delivery?: boolean;
      reorder_point?: number | null;
      reorder_quantity?: number | null;
      default_location_id?: string | null;
    },
  ): Promise<IProductInventorySettings | ProductInventorySettingsActionError> => {
    return withProductInventorySettingsActionErrors(async () => {
      await requireInvPerm(user, 'create');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const { cost_currency } = await assertProduct(trx, tenant, serviceId);

        // Default preferred vendor from the legacy freeform service_catalog.vendor, if it maps to a vendor.
        const svc = await trx('service_catalog').where({ tenant, service_id: serviceId }).select('vendor').first();
        let preferredVendorId: string | null = null;
        if (svc?.vendor && String(svc.vendor).trim()) {
          const vendor = await trx('vendors')
            .where({ tenant })
            .whereRaw('LOWER(vendor_name) = LOWER(?)', [String(svc.vendor).trim()])
            .first();
          preferredVendorId = vendor?.vendor_id ?? null;
        }

        const [row] = await trx('product_inventory_settings')
          .insert({
            tenant,
            service_id: serviceId,
            track_stock: true,
            is_serialized: input?.is_serialized ?? false,
            is_kit: input?.is_kit ?? false,
            creates_asset_on_delivery: input?.creates_asset_on_delivery ?? false,
            reorder_point: input?.reorder_point ?? null,
            reorder_quantity: input?.reorder_quantity ?? null,
            cost_currency: cost_currency ?? 'USD',
            default_location_id: input?.default_location_id ?? null,
            preferred_vendor_id: preferredVendorId,
          })
          .onConflict(['tenant', 'service_id'])
          .merge({ track_stock: true })
          .returning('*');
        return row as IProductInventorySettings;
      });
    });
  },
);

export const updateInventorySettings = withAuth(
  async (
    user,
    { tenant },
    serviceId: string,
    patch: Partial<
      Pick<
        IProductInventorySettings,
        | 'track_stock'
        | 'creates_asset_on_delivery'
        | 'reorder_point'
        | 'reorder_quantity'
        | 'default_location_id'
        | 'preferred_vendor_id'
        | 'kit_pricing_mode'
        | 'kit_fixed_price'
        | 'default_asset_type'
      >
    >,
  ): Promise<IProductInventorySettings | ProductInventorySettingsActionError> => {
    return withProductInventorySettingsActionErrors(async () => {
      await requireInvPerm(user, 'update');
      if (patch.kit_pricing_mode && !(['sum', 'fixed'] as KitPricingMode[]).includes(patch.kit_pricing_mode)) {
        throw new Error(`Invalid kit_pricing_mode: ${patch.kit_pricing_mode}`);
      }
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const update: Record<string, unknown> = { updated_at: trx.fn.now() };
        for (const k of [
          'track_stock',
          'creates_asset_on_delivery',
          'reorder_point',
          'reorder_quantity',
          'default_location_id',
          'preferred_vendor_id',
          'kit_pricing_mode',
          'kit_fixed_price',
          'default_asset_type',
        ] as const) {
          if (k in patch) update[k] = (patch as any)[k];
        }
        const [row] = await trx('product_inventory_settings').where({ tenant, service_id: serviceId }).update(update).returning('*');
        if (!row) throw new Error('Inventory not enabled for this product');
        return row as IProductInventorySettings;
      });
    });
  },
);

/** Toggle serialized tracking. Disabling is blocked while serialized units exist. */
export const setProductSerialized = withAuth(
  async (user, { tenant }, serviceId: string, isSerialized: boolean): Promise<IProductInventorySettings | ProductInventorySettingsActionError> => {
    return withProductInventorySettingsActionErrors(async () => {
      await requireInvPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        if (!isSerialized) {
          const unit = await trx('stock_units').where({ tenant, service_id: serviceId }).first();
          if (unit) throw new Error('Cannot disable serialization while serialized units exist for this product');
        }
        const [row] = await trx('product_inventory_settings')
          .where({ tenant, service_id: serviceId })
          .update({ is_serialized: isSerialized, updated_at: trx.fn.now() })
          .returning('*');
        if (!row) throw new Error('Inventory not enabled for this product');
        return row as IProductInventorySettings;
      });
    });
  },
);

/** Toggle kit flag. Disabling is blocked while the kit still has components defined. */
export const setProductKit = withAuth(
  async (user, { tenant }, serviceId: string, isKit: boolean): Promise<IProductInventorySettings | ProductInventorySettingsActionError> => {
    return withProductInventorySettingsActionErrors(async () => {
      await requireInvPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        if (!isKit) {
          const comp = await trx('kit_components').where({ tenant, kit_service_id: serviceId }).first();
          if (comp) throw new Error('Cannot clear the kit flag while the kit still has components; remove components first');
        }
        const [row] = await trx('product_inventory_settings')
          .where({ tenant, service_id: serviceId })
          .update({ is_kit: isKit, updated_at: trx.fn.now() })
          .returning('*');
        if (!row) throw new Error('Inventory not enabled for this product');
        return row as IProductInventorySettings;
      });
    });
  },
);
