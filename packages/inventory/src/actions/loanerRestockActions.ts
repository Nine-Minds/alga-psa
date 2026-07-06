'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockMovement, IStockUnit, IProductInventorySettings } from '@alga-psa/types';
import { recordStockMovement, ensureStockLevel, assertLocationWritable } from '../lib';

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

/**
 * Loaner dispatch (design §6.E). A serialized unit goes out on loan to a client:
 * `in_stock → on_loan`, set `client_id` + `loan_due_at`, clear location. NO COGS,
 * NO invoice — a loaner is not a sale, and it is excluded from quantity_on_hand.
 */
export const loanOut = withAuth(
  async (
    user,
    { tenant },
    unitId: string,
    input: { client_id: string; loan_due_at?: string | Date | null },
  ): Promise<IStockMovement> => {
    await requireInvPerm(user, 'update');
    if (!input?.client_id) throw new Error('client_id is required to loan out a unit');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const unit = (await trx('stock_units').where({ tenant, unit_id: unitId }).first()) as IStockUnit | undefined;
      if (!unit) throw new Error('Stock unit not found');
      if (unit.status !== 'in_stock') {
        throw new Error(`Unit must be in_stock to loan out (current status: ${unit.status})`);
      }
      // A tech can't loan stock out of another tech's van (F036).
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, unit.location_id);
      return recordStockMovement(trx, tenant, {
        movement_type: 'loan_out',
        service_id: unit.service_id,
        quantity: 1,
        unit_id: unitId,
        from_location_id: unit.location_id ?? null,
        source_doc_type: 'loan',
        performed_by: user.user_id,
        unitPatch: {
          status: 'on_loan',
          client_id: input.client_id,
          loan_due_at: input.loan_due_at ?? null,
          location_id: null,
        },
      });
    });
  },
);

/**
 * Loaner return (design §6.E). A unit comes back from loan into stock:
 * `on_loan → in_stock`, restore location, clear client_id + loan_due_at.
 */
export const loanReturn = withAuth(
  async (user, { tenant }, unitId: string, input: { location_id: string }): Promise<IStockMovement> => {
    await requireInvPerm(user, 'update');
    if (!input?.location_id) throw new Error('location_id is required to return a loaner');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const unit = (await trx('stock_units').where({ tenant, unit_id: unitId }).first()) as IStockUnit | undefined;
      if (!unit) throw new Error('Stock unit not found');
      if (unit.status !== 'on_loan') {
        throw new Error(`Unit must be on_loan to return (current status: ${unit.status})`);
      }
      // Returning into a location writes there — same van scoping applies (F036).
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, input.location_id);
      await ensureStockLevel(trx, tenant, unit.service_id, input.location_id);
      return recordStockMovement(trx, tenant, {
        movement_type: 'loan_in',
        service_id: unit.service_id,
        quantity: 1,
        unit_id: unitId,
        to_location_id: input.location_id,
        source_doc_type: 'loan',
        performed_by: user.user_id,
        unitPatch: {
          status: 'in_stock',
          location_id: input.location_id,
          client_id: null,
          loan_due_at: null,
        },
      });
    });
  },
);

export interface LoanerOutRow {
  unit_id: string;
  service_id: string;
  service_name: string | null;
  sku: string | null;
  serial_number: string;
  mac_address: string | null;
  client_id: string | null;
  client_name: string | null;
  loan_due_at: string | Date | null;
}

/**
 * Loaners-out report (design §6.E): which units are out, with whom, and when due back.
 */
export const loanersOutReport = withAuth(async (user, { tenant }): Promise<LoanerOutRow[]> => {
  await requireInvPerm(user, 'read');
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    return trx('stock_units as su')
      .leftJoin('service_catalog as sc', function () {
        this.on('su.service_id', '=', 'sc.service_id').andOn('su.tenant', '=', 'sc.tenant');
      })
      .leftJoin('clients as c', function () {
        this.on('su.client_id', '=', 'c.client_id').andOn('su.tenant', '=', 'c.tenant');
      })
      .where({ 'su.tenant': tenant, 'su.status': 'on_loan' })
      .select(
        'su.unit_id',
        'su.service_id',
        'sc.service_name',
        'sc.sku',
        'su.serial_number',
        'su.mac_address',
        'su.client_id',
        'c.client_name',
        'su.loan_due_at',
      )
      .orderBy('su.loan_due_at', 'asc') as unknown as Promise<LoanerOutRow[]>;
  });
});

export interface RestockReturnResult {
  movement: IStockMovement;
  restocking_fee_cents: number | null;
}

/**
 * Restock-to-sellable return (design §6.H). Return of opened-but-unused GOOD stock
 * back to SELLABLE inventory — distinct from defective/RMA paths. This DOES increment
 * quantity_on_hand. An optional restocking fee is passed back for the caller to credit
 * (this action does not create the credit memo itself).
 *
 * Serialized: provide `unit_id` (must be a delivered/returned unit) — `→ in_stock`,
 * restored to `location_id`, client_id + delivered_at cleared.
 * Non-serialized: provide `service_id`, `location_id`, and `quantity`.
 */
export const restockReturn = withAuth(
  async (
    user,
    { tenant },
    input: {
      unit_id?: string;
      service_id?: string;
      location_id?: string;
      quantity?: number;
      restocking_fee_cents?: number | null;
    },
  ): Promise<RestockReturnResult> => {
    await requireInvPerm(user, 'update');
    const restockingFee = input.restocking_fee_cents ?? null;
    if (restockingFee != null && (!Number.isInteger(restockingFee) || restockingFee < 0)) {
      throw new Error('restocking_fee_cents must be a non-negative integer (cents)');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Serialized path: a specific unit comes back to sellable stock.
      if (input.unit_id) {
        const unit = (await trx('stock_units').where({ tenant, unit_id: input.unit_id }).first()) as
          | IStockUnit
          | undefined;
        if (!unit) throw new Error('Stock unit not found');
        if (!['delivered', 'returned'].includes(unit.status)) {
          throw new Error(`Unit must be delivered or returned to restock (current status: ${unit.status})`);
        }
        const targetLocation = input.location_id ?? unit.location_id ?? null;
        if (!targetLocation) throw new Error('location_id is required to restock this unit');
        // Restocking writes into the location — van scoping applies (F036).
        await assertLocationWritable(trx, tenant, (user as any)?.user_id, targetLocation);
        await ensureStockLevel(trx, tenant, unit.service_id, targetLocation);
        const movement = await recordStockMovement(trx, tenant, {
          movement_type: 'return_restock',
          service_id: unit.service_id,
          quantity: 1,
          unit_id: input.unit_id,
          to_location_id: targetLocation,
          reason: 'restock-to-sellable',
          source_doc_type: 'manual',
          performed_by: user.user_id,
          unitPatch: {
            status: 'in_stock',
            location_id: targetLocation,
            client_id: null,
            delivered_at: null,
          },
        });
        return { movement, restocking_fee_cents: restockingFee };
      }

      // Non-serialized path: a quantity returns to a location's sellable on-hand.
      if (!input.service_id || !input.location_id) {
        throw new Error('service_id and location_id are required for a non-serialized restock return');
      }
      const quantity = input.quantity ?? 0;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('quantity must be a positive number for a non-serialized restock return');
      }
      // Guard against restocking a serialized product without a unit.
      const settings = (await trx('product_inventory_settings')
        .where({ tenant, service_id: input.service_id })
        .first()) as IProductInventorySettings | undefined;
      if (settings?.is_serialized) {
        throw new Error('This product is serialized; provide unit_id to restock a specific unit');
      }
      // Restocking writes into the location — van scoping applies (F036).
      await assertLocationWritable(trx, tenant, (user as any)?.user_id, input.location_id);
      await ensureStockLevel(trx, tenant, input.service_id, input.location_id);
      const movement = await recordStockMovement(trx, tenant, {
        movement_type: 'return_restock',
        service_id: input.service_id,
        quantity,
        to_location_id: input.location_id,
        reason: 'restock-to-sellable',
        source_doc_type: 'manual',
        performed_by: user.user_id,
      });
      return { movement, restocking_fee_cents: restockingFee };
    });
  },
);
