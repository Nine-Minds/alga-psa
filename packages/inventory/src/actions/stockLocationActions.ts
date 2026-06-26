'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockLocation, StockLocationType } from '@alga-psa/types';

const LOCATION_TYPES: StockLocationType[] = ['warehouse', 'van', 'office', 'other'];

async function requireLocationPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  // stock_location permissions are read/update/create/delete; reads also allowed for inventory readers.
  if (!(await hasPermission(user, 'stock_location', action))) {
    throw new Error(`Permission denied: stock_location ${action} required`);
  }
}

export const listStockLocations = withAuth(
  async (user, { tenant }, opts?: { includeInactive?: boolean }): Promise<IStockLocation[]> => {
    await requireLocationPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('stock_locations').where({ tenant });
      if (!opts?.includeInactive) q.andWhere({ is_active: true });
      return (await q.orderBy('name', 'asc')) as IStockLocation[];
    });
  },
);

export const getStockLocation = withAuth(
  async (user, { tenant }, locationId: string): Promise<IStockLocation | null> => {
    await requireLocationPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const row = await trx('stock_locations').where({ tenant, location_id: locationId }).first();
      return (row ?? null) as IStockLocation | null;
    });
  },
);

export const createStockLocation = withAuth(
  async (
    user,
    { tenant },
    input: {
      name: string;
      location_type?: StockLocationType;
      assigned_user_id?: string | null;
      manager_user_id?: string | null;
      is_default?: boolean;
    },
  ): Promise<IStockLocation> => {
    await requireLocationPerm(user, 'create');
    const name = (input.name ?? '').trim();
    if (!name) throw new Error('Location name is required');
    const locationType: StockLocationType = input.location_type ?? 'warehouse';
    if (!LOCATION_TYPES.includes(locationType)) throw new Error(`Invalid location_type: ${locationType}`);

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Enforce a single default per tenant: clear the existing default first.
      if (input.is_default) {
        await trx('stock_locations').where({ tenant, is_default: true }).update({ is_default: false, updated_at: trx.fn.now() });
      }
      const [row] = await trx('stock_locations')
        .insert({
          tenant,
          name,
          location_type: locationType,
          assigned_user_id: input.assigned_user_id ?? null,
          manager_user_id: input.manager_user_id ?? null,
          is_default: input.is_default ?? false,
          is_active: true,
        })
        .returning('*');
      return row as IStockLocation;
    });
  },
);

export const updateStockLocation = withAuth(
  async (
    user,
    { tenant },
    locationId: string,
    patch: Partial<Pick<IStockLocation, 'name' | 'location_type' | 'assigned_user_id' | 'manager_user_id' | 'is_default' | 'is_active'>>,
  ): Promise<IStockLocation> => {
    await requireLocationPerm(user, 'update');
    if (patch.location_type && !LOCATION_TYPES.includes(patch.location_type)) {
      throw new Error(`Invalid location_type: ${patch.location_type}`);
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      if (patch.is_default === true) {
        await trx('stock_locations')
          .where({ tenant, is_default: true })
          .andWhereNot({ location_id: locationId })
          .update({ is_default: false, updated_at: trx.fn.now() });
      }
      const update: Record<string, unknown> = { updated_at: trx.fn.now() };
      for (const k of ['name', 'location_type', 'assigned_user_id', 'manager_user_id', 'is_default', 'is_active'] as const) {
        if (k in patch) update[k] = (patch as any)[k];
      }
      if (typeof update.name === 'string') update.name = (update.name as string).trim();
      const [row] = await trx('stock_locations').where({ tenant, location_id: locationId }).update(update).returning('*');
      if (!row) throw new Error('Location not found');
      return row as IStockLocation;
    });
  },
);

/**
 * Deactivate a location. Guarded: cannot deactivate a location that still holds
 * sellable stock or has units physically present.
 */
export const deactivateStockLocation = withAuth(
  async (user, { tenant }, locationId: string): Promise<IStockLocation> => {
    await requireLocationPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const onHand = await trx('stock_levels')
        .where({ tenant, location_id: locationId })
        .andWhere('quantity_on_hand', '>', 0)
        .first();
      if (onHand) throw new Error('Cannot deactivate a location that still holds stock');

      const units = await trx('stock_units')
        .where({ tenant, location_id: locationId })
        .whereIn('status', ['in_stock', 'allocated', 'in_transit'])
        .first();
      if (units) throw new Error('Cannot deactivate a location that still holds units');

      const [row] = await trx('stock_locations')
        .where({ tenant, location_id: locationId })
        .update({ is_active: false, updated_at: trx.fn.now() })
        .returning('*');
      if (!row) throw new Error('Location not found');
      return row as IStockLocation;
    });
  },
);
