'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockUnit, IStockMovement, StockUnitStatus, StockMovementType } from '@alga-psa/types';

async function requireInvRead(user: any): Promise<void> {
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    throw new Error('Permission denied: inventory read required');
  }
}

/**
 * In-stock serialized units available to pick for a product (serial + MAC),
 * used by the ticket/project material dialogs to choose which unit to deliver.
 * Returns [] for non-serialized products (they have no unit rows).
 */
export const listAvailableStockUnits = withAuth(
  async (user, { tenant }, serviceId: string): Promise<IStockUnit[]> => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return (await trx('stock_units')
        .where({ tenant, service_id: serviceId, status: 'in_stock' })
        .orderBy('received_at', 'asc')) as IStockUnit[];
    });
  },
);

/** Escape LIKE wildcards in a user-supplied search term so they match literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Base query for UI listings: `stock_units` plus its resolved location and client
 * NAMES via LEFT JOINs, so tables never have to render raw FK UUIDs. Callers add
 * their own filters on the `su.*` columns and choose the order.
 */
function stockUnitsWithNames(trx: Knex.Transaction, tenant: string) {
  return trx('stock_units as su')
    .leftJoin('stock_locations as sl', function () {
      this.on('su.location_id', '=', 'sl.location_id').andOn('su.tenant', '=', 'sl.tenant');
    })
    .leftJoin('clients as c', function () {
      this.on('su.client_id', '=', 'c.client_id').andOn('su.tenant', '=', 'c.tenant');
    })
    .leftJoin('service_catalog as sc', function () {
      this.on('su.service_id', '=', 'sc.service_id').andOn('su.tenant', '=', 'sc.tenant');
    })
    .where({ 'su.tenant': tenant })
    .select('su.*', 'sl.name as location_name', 'c.client_name', 'sc.service_name as product_name');
}

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
  ): Promise<IStockUnit[]> => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = stockUnitsWithNames(trx, tenant);
      if (filter?.service_id) q.andWhere({ 'su.service_id': filter.service_id });
      if (filter?.status) q.andWhere({ 'su.status': filter.status });
      if (filter?.location_id) q.andWhere({ 'su.location_id': filter.location_id });
      if (filter?.client_id) q.andWhere({ 'su.client_id': filter.client_id });
      return (await q.orderBy('su.received_at', 'desc')) as IStockUnit[];
    });
  },
);

export const getStockUnit = withAuth(
  async (user, { tenant }, unitId: string): Promise<IStockUnit | null> => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const row = await trx('stock_units').where({ tenant, unit_id: unitId }).first();
      return (row ?? null) as IStockUnit | null;
    });
  },
);

/**
 * Search units by serial number (case-insensitive substring). For RMA /
 * provisioning lookups. Returns units in any status.
 */
export const searchUnitsBySerial = withAuth(
  async (user, { tenant }, q: string): Promise<IStockUnit[]> => {
    await requireInvRead(user);
    const term = (q ?? '').trim();
    if (!term) return [];
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return (await stockUnitsWithNames(trx, tenant)
        .whereRaw('su.serial_number ILIKE ? ESCAPE ?', [`%${escapeLike(term)}%`, '\\'])
        .orderBy('su.received_at', 'desc')) as IStockUnit[];
    });
  },
);

/**
 * Search units by MAC address (case-insensitive substring). A MAC is
 * tenant-unique; provisioning and field lookups key on it. Any status.
 */
export const searchUnitsByMac = withAuth(
  async (user, { tenant }, q: string): Promise<IStockUnit[]> => {
    await requireInvRead(user);
    const term = (q ?? '').trim();
    if (!term) return [];
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return (await stockUnitsWithNames(trx, tenant)
        .whereNotNull('su.mac_address')
        .whereRaw('su.mac_address ILIKE ? ESCAPE ?', [`%${escapeLike(term)}%`, '\\'])
        .orderBy('su.received_at', 'desc')) as IStockUnit[];
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
  ): Promise<{ unit: IStockUnit; movements: IStockMovement[] } | null> => {
    await requireInvRead(user);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const unit = (await trx('stock_units').where({ tenant, unit_id: unitId }).first()) as
        | IStockUnit
        | undefined;
      if (!unit) return null;
      const movements = (await trx('stock_movements')
        .where({ tenant, unit_id: unitId })
        .orderBy('created_at', 'asc')) as IStockMovement[];
      return { unit, movements };
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
  ): Promise<IStockMovement[]> => {
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
  ): Promise<IStockUnit[]> => {
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
  },
);
