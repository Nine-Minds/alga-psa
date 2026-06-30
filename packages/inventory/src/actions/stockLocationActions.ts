'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockLocation, StockLocationType } from '@alga-psa/types';

const LOCATION_TYPES: StockLocationType[] = ['warehouse', 'van', 'office', 'other'];

const ADDRESS_FIELDS = [
  'address_line1',
  'address_line2',
  'city',
  'state_province',
  'postal_code',
  'country_code',
] as const;

/** Pull the address fields out of an input, trimming to null so blanks don't store empty strings. */
function pickAddress(input: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of ADDRESS_FIELDS) {
    if (f in input) {
      const v = input[f];
      out[f] = typeof v === 'string' && v.trim() ? v.trim() : null;
    }
  }
  return out;
}

async function requireLocationPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  // stock_location permissions are read/update/create/delete; reads also allowed for inventory readers.
  if (!(await hasPermission(user, 'stock_location', action))) {
    throw new Error(`Permission denied: stock_location ${action} required`);
  }
}

export const listStockLocations = withAuth(
  async (
    user,
    { tenant },
    opts?: { includeInactive?: boolean; includeStock?: boolean },
  ): Promise<IStockLocation[]> => {
    await requireLocationPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Plain list (most callers): no occupancy join, so the dropdowns/pickers stay cheap.
      if (!opts?.includeStock) {
        const q = trx('stock_locations').where({ tenant });
        if (!opts?.includeInactive) q.andWhere({ is_active: true });
        return (await q.orderBy('name', 'asc')) as IStockLocation[];
      }

      // Occupancy per location in one round-trip. The row displays item_type_count — the number of
      // DISTINCT products on hand — because a summed piece-count across unlike items (phones + cables)
      // isn't a meaningful quantity, whereas "how many kinds are here" is, and it stays legible from 3
      // to 750 types. on_hand_qty (SUM of quantity_on_hand, which already folds serialized in-stock
      // units in via the recompute) is kept as a coarse total for the drill-in header. unit_count
      // (present serialized units) is kept only to gate Deactivate and flag units present-but-not-on-
      // hand (allocated / in transit). COALESCE so empty locations read 0.
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

      const q = trx('stock_locations as loc')
        .leftJoin(levelAgg, 'lvl.location_id', 'loc.location_id')
        .leftJoin(unitAgg, 'un.location_id', 'loc.location_id')
        .where('loc.tenant', tenant);
      if (!opts?.includeInactive) q.andWhere('loc.is_active', true);

      const rows = await q
        .orderBy('loc.name', 'asc')
        .select(
          'loc.*',
          trx.raw('COALESCE(lvl.item_type_count, 0) as item_type_count'),
          trx.raw('COALESCE(lvl.on_hand_qty, 0) as on_hand_qty'),
          trx.raw('COALESCE(un.unit_count, 0) as unit_count'),
        );
      return rows.map((r: any) => ({
        ...r,
        item_type_count: Number(r.item_type_count),
        on_hand_qty: Number(r.on_hand_qty),
        unit_count: Number(r.unit_count),
      })) as IStockLocation[];
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
    } & Partial<Record<(typeof ADDRESS_FIELDS)[number], string | null>>,
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
          ...pickAddress(input),
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
    patch: Partial<Pick<IStockLocation, 'name' | 'location_type' | 'assigned_user_id' | 'manager_user_id' | 'is_default' | 'is_active' | (typeof ADDRESS_FIELDS)[number]>>,
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
      const update: Record<string, unknown> = { updated_at: trx.fn.now(), ...pickAddress(patch as Record<string, unknown>) };
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
