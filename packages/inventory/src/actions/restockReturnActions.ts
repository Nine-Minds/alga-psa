'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockMovement, IStockUnit, IProductInventorySettings } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { recordStockMovement, ensureStockLevel, assertLocationWritable } from '../lib';

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type RestockReturnActionError = ActionMessageError | ActionPermissionError;

// Human labels for the raw unit statuses, so the delivered/returned guard reads as a
// sentence and never leaks a snake_case enum value into a toast.
const STATUS_LABELS: Record<string, string> = {
  in_stock: 'In stock',
  allocated: 'Allocated',
  in_transit: 'In transit',
  on_loan: 'On loan',
  delivered: 'Delivered',
  returned: 'Returned',
  in_rma: 'In RMA',
  retired: 'Retired',
};

function humanStatus(raw: string): string {
  return STATUS_LABELS[raw] ?? raw.replace(/_/g, ' ');
}

function currentStatusOf(message: string): string | null {
  const m = message.match(/\(current status: ([^)]+)\)/);
  return m ? m[1] : null;
}

function restockReturnActionErrorFrom(error: unknown): RestockReturnActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Stock unit not found':
        return actionError('Stock unit not found. It may have been updated or deleted. Refresh and try again.');
      case 'restocking_fee_cents must be a non-negative integer (cents)':
        return actionError('Restocking fee must be a non-negative amount.');
      case 'location_id is required to restock this unit':
        return actionError('Choose a location to restock this unit.');
      case 'service_id and location_id are required for a non-serialized restock return':
        return actionError('Choose a product and location before restocking non-serialized inventory.');
      case 'quantity must be a positive number for a non-serialized restock return':
        return actionError('Restock quantity must be greater than zero.');
      case 'This product is serialized; provide unit_id to restock a specific unit':
        return actionError('This product is serialized. Choose the specific unit to restock.');
    }

    if (error.message.startsWith('Unit must be delivered or returned ')) {
      const status = currentStatusOf(error.message);
      return actionError(
        status
          ? `This unit can't be restocked — it's currently ${humanStatus(status)}. Only delivered or returned units can be restocked.`
          : "This unit can't be restocked. Only delivered or returned units can be restocked.",
      );
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError("That doesn't look like a valid record reference. Pick the unit and location from the lists.");
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected records is no longer valid. Refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This restock conflicts with an existing record. Refresh and try again.');
  }

  return null;
}

async function withRestockReturnActionErrors<T>(work: () => Promise<T>): Promise<T | RestockReturnActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = restockReturnActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

export interface RestockReturnResult {
  movement: IStockMovement;
  restocking_fee_cents: number | null;
  /** The client the serialized unit was out with, read before restock clears it (fee billing). */
  client_id: string | null;
  service_id: string;
  serial_number: string | null;
}

/**
 * Restock-to-sellable return (design §6.H). Return of opened-but-unused GOOD stock
 * back to SELLABLE inventory — distinct from defective/RMA paths. This DOES increment
 * quantity_on_hand. An optional restocking fee is passed back for the caller to bill
 * (this action does not create the invoice itself — see billing's restockReturnWithFee).
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
  ): Promise<RestockReturnResult | RestockReturnActionError> => {
    return withRestockReturnActionErrors(async () => {
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
        // Read the client BEFORE the patch clears it, so a fee can be billed to them.
        const priorClientId = unit.client_id ?? null;
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
        return {
          movement,
          restocking_fee_cents: restockingFee,
          client_id: priorClientId,
          service_id: unit.service_id,
          serial_number: unit.serial_number ?? null,
        };
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
      return {
        movement,
        restocking_fee_cents: restockingFee,
        // Non-serialized restock isn't tied to one client; billing requires client_id from the caller.
        client_id: null,
        service_id: input.service_id,
        serial_number: null,
      };
    });
    });
  },
);
