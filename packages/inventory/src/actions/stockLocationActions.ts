'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockLocation, StockLocationType } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { queryStockLocation, queryStockLocations } from '../lib';

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

/**
 * Address columns ship in a migration; tolerate the brief window where the code is deployed but the
 * migration hasn't run yet (and this dev DB, where it can't be applied without the admin role). When
 * the columns are absent, address writes are skipped rather than erroring the whole create/edit.
 */
async function addressColumnsAvailable(trx: Knex | Knex.Transaction): Promise<boolean> {
  return trx.schema.hasColumn('stock_locations', 'address_line1');
}

async function requireLocationPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  // stock_location permissions are read/update/create/delete; reads also allowed for inventory readers.
  if (!(await hasPermission(user, 'stock_location', action))) {
    throw new Error(`Permission denied: stock_location ${action} required`);
  }
}

export type StockLocationActionError = ActionMessageError | ActionPermissionError;

function stockLocationActionErrorFrom(error: unknown): StockLocationActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Location name is required':
        return actionError('Location name is required.');
      case 'Location not found':
        return actionError('Location not found. It may have been updated or deleted. Please refresh and try again.');
      case 'Cannot deactivate a location that still holds stock':
        return actionError('Move all stock out of this location before deactivating it.');
      case 'Cannot deactivate a location that still holds units':
        return actionError('Move or retire all units from this location before deactivating it.');
      default:
        if (error.message.startsWith('Invalid location_type:')) {
          return actionError('Choose a valid location type.');
        }
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected location records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A location with these details already exists.');
  }

  return null;
}

async function withStockLocationActionErrors<T>(work: () => Promise<T>): Promise<T | StockLocationActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = stockLocationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

export const listStockLocations = withAuth(
  async (
    user,
    { tenant },
    opts?: { includeInactive?: boolean; includeStock?: boolean },
  ): Promise<IStockLocation[] | StockLocationActionError> => {
    return withStockLocationActionErrors(async () => {
      await requireLocationPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryStockLocations(trx, tenant, opts));
    });
  },
);

export const getStockLocation = withAuth(
  async (user, { tenant }, locationId: string): Promise<IStockLocation | null | StockLocationActionError> => {
    return withStockLocationActionErrors(async () => {
      await requireLocationPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryStockLocation(trx, tenant, locationId));
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
  ): Promise<IStockLocation | StockLocationActionError> => {
    return withStockLocationActionErrors(async () => {
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
            ...((await addressColumnsAvailable(trx)) ? pickAddress(input) : {}),
          })
          .returning('*');
        return row as IStockLocation;
      });
    });
  },
);

export const updateStockLocation = withAuth(
  async (
    user,
    { tenant },
    locationId: string,
    patch: Partial<Pick<IStockLocation, 'name' | 'location_type' | 'assigned_user_id' | 'manager_user_id' | 'is_default' | 'is_active' | (typeof ADDRESS_FIELDS)[number]>>,
  ): Promise<IStockLocation | StockLocationActionError> => {
    return withStockLocationActionErrors(async () => {
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
        const update: Record<string, unknown> = {
          updated_at: trx.fn.now(),
          ...((await addressColumnsAvailable(trx)) ? pickAddress(patch as Record<string, unknown>) : {}),
        };
        for (const k of ['name', 'location_type', 'assigned_user_id', 'manager_user_id', 'is_default', 'is_active'] as const) {
          if (k in patch) update[k] = (patch as any)[k];
        }
        if (typeof update.name === 'string') update.name = (update.name as string).trim();
        const [row] = await trx('stock_locations').where({ tenant, location_id: locationId }).update(update).returning('*');
        if (!row) throw new Error('Location not found');
        return row as IStockLocation;
      });
    });
  },
);

/**
 * Deactivate a location. Guarded: cannot deactivate a location that still holds
 * sellable stock or has units physically present.
 */
export const deactivateStockLocation = withAuth(
  async (user, { tenant }, locationId: string): Promise<IStockLocation | StockLocationActionError> => {
    return withStockLocationActionErrors(async () => {
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
    });
  },
);
