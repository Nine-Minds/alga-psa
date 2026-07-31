'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockUnit, IStockMovement, StockUnitStatus, StockMovementType } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  queryInStockUnits,
  queryStockUnits,
  queryUnitDetail,
  queryUnitsByMac,
  queryUnitsBySerial,
} from '../lib';

async function requireInvRead(user: any): Promise<void> {
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    throw new Error('Permission denied: inventory read required');
  }
}

export type StockUnitActionError = ActionMessageError | ActionPermissionError;

function stockUnitActionErrorFrom(error: unknown): StockUnitActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected stock-unit values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '22007' || dbError?.code === '22008') {
    return actionError('Choose a valid stock movement date range.');
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected stock-unit records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This stock-unit lookup conflicts with an existing record. Please refresh and try again.');
  }

  return null;
}

async function withStockUnitActionErrors<T>(work: () => Promise<T>): Promise<T | StockUnitActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = stockUnitActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

/**
 * In-stock serialized units available to pick for a product (serial + MAC),
 * used by the ticket/project material dialogs to choose which unit to deliver.
 * Returns [] for non-serialized products (they have no unit rows).
 */
export const listAvailableStockUnits = withAuth(
  async (user, { tenant }, serviceId: string): Promise<IStockUnit[] | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
      await requireInvRead(user);
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        return (await trx('stock_units')
          .where({ tenant, service_id: serviceId, status: 'in_stock' })
          .orderBy('received_at', 'asc')) as IStockUnit[];
      });
    });
  },
);

/**
 * List serialized units with optional filters. Newest-received first.
 * Rows carry resolved `location_name` / `client_name` for display.
 */
export const listStockUnits = withAuth(
  async (
    user,
    { tenant },
    filter?: {
      service_id?: string;
      status?: StockUnitStatus;
      location_id?: string;
      client_id?: string;
    },
  ): Promise<IStockUnit[] | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
      await requireInvRead(user);
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryStockUnits(trx, tenant, filter));
    });
  },
);

export const getStockUnit = withAuth(
  async (user, { tenant }, unitId: string): Promise<IStockUnit | null | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
      await requireInvRead(user);
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const row = await trx('stock_units').where({ tenant, unit_id: unitId }).first();
        return (row ?? null) as IStockUnit | null;
      });
    });
  },
);

/**
 * Search units by serial number (case-insensitive substring). For RMA /
 * provisioning lookups. Returns units in any status.
 */
export const searchUnitsBySerial = withAuth(
  async (user, { tenant }, q: string): Promise<IStockUnit[] | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, (trx: Knex.Transaction) => queryUnitsBySerial(trx, tenant, q));
    });
  },
);

/**
 * Search units by MAC address (case-insensitive substring). A MAC is
 * tenant-unique; provisioning and field lookups key on it. Any status.
 */
export const searchUnitsByMac = withAuth(
  async (user, { tenant }, q: string): Promise<IStockUnit[] | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, (trx: Knex.Transaction) => queryUnitsByMac(trx, tenant, q));
    });
  },
);

/**
 * Paged picker query behind the loan-out unit selector: in-stock units whose
 * serial OR MAC matches the term (any-field ILIKE, so no client-side guessing
 * about which one the user typed). An empty term browses the whole in-stock
 * pool — a picker that shows nothing until you type reads as "no stock". The
 * real `total` comes back with the page so the UI can say "showing N of M".
 */
export const searchInStockUnits = withAuth(
  async (
    user,
    { tenant },
    input?: { search?: string; page?: number; limit?: number },
  ): Promise<{ units: IStockUnit[]; total: number } | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
      await requireInvRead(user);
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, (trx: Knex.Transaction) => queryInStockUnits(trx, tenant, input));
    });
  },
);

/**
 * A unit plus its full movement history (oldest → newest), the unit-lifecycle
 * record that bridges stock → deployed asset → RMA.
 */
export const getUnitDetail = withAuth(
  async (
    user,
    { tenant },
    unitId: string,
  ): Promise<{ unit: IStockUnit; movements: IStockMovement[] } | null | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, (trx: Knex.Transaction) => queryUnitDetail(trx, tenant, unitId));
    });
  },
);

/**
 * The movement ledger query. `location_id` matches either side of a movement
 * (from or to). `from`/`to` bound `created_at` (inclusive). Newest first.
 */
export const listStockMovements = withAuth(
  async (
    user,
    { tenant },
    filter?: {
      service_id?: string;
      location_id?: string;
      movement_type?: StockMovementType;
      unit_id?: string;
      from?: string | Date;
      to?: string | Date;
    },
  ): Promise<IStockMovement[] | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('stock_movements').where({ tenant });
      if (filter?.service_id) q.andWhere({ service_id: filter.service_id });
      if (filter?.movement_type) q.andWhere({ movement_type: filter.movement_type });
      if (filter?.unit_id) q.andWhere({ unit_id: filter.unit_id });
      if (filter?.location_id) {
        q.andWhere((b) => {
          b.where('from_location_id', filter.location_id).orWhere('to_location_id', filter.location_id);
        });
      }
      if (filter?.from) q.andWhere('created_at', '>=', filter.from);
      if (filter?.to) q.andWhere('created_at', '<=', filter.to);
      return (await q.orderBy('created_at', 'desc')) as IStockMovement[];
    });
    });
  },
);

/**
 * Fault / security advisory lookup: return ALL units matching any of the given
 * serials or MACs, regardless of status — in-stock AND already deployed. Used
 * when a vendor advisory names affected serials/MACs and we need every unit we
 * have ever touched (so deployed units at clients surface too).
 */
export const advisoryLookup = withAuth(
  async (
    user,
    { tenant },
    input: { serials?: string[]; macs?: string[] },
  ): Promise<IStockUnit[] | StockUnitActionError> => {
    return withStockUnitActionErrors(async () => {
    await requireInvRead(user);
    const serials = (input.serials ?? []).map((s) => (s ?? '').trim()).filter(Boolean);
    const macs = (input.macs ?? []).map((m) => (m ?? '').trim()).filter(Boolean);
    if (serials.length === 0 && macs.length === 0) return [];
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('stock_units').where({ tenant }).andWhere((b) => {
        if (serials.length > 0) {
          b.orWhereRaw('LOWER(serial_number) = ANY(?)', [serials.map((s) => s.toLowerCase())]);
        }
        if (macs.length > 0) {
          b.orWhereRaw('LOWER(mac_address) = ANY(?)', [macs.map((m) => m.toLowerCase())]);
        }
      });
      return (await q.orderBy('received_at', 'desc')) as IStockUnit[];
    });
    });
  },
);
