'use server';

import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { tenantDb, withTransaction, createTenantKnex } from '@alga-psa/db';
import { authorizeTicketRecordAccess } from '@alga-psa/authorization/ticketRecordAuthorization';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IStockMovement, IStockUnit, IProductInventorySettings, IUserWithRoles } from '@alga-psa/types';
import {
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { recordStockMovement, ensureStockLevel, assertLocationWritable } from '../lib';
import { detachDeliveredAssetAssociation } from '../lib/assetLink';
import { findLatestUnitDelivery } from '../lib/consume';
import { restockReturnActionErrorFrom } from './loanerRestockErrors';

async function requireInvPerm(user: IUserWithRoles, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type RestockReturnActionError = ActionMessageError | ActionPermissionError;

/**
 * When the unit's LATEST delivery is a ticket/project material line, remove that line: this
 * restock is the stock reversal, so leaving it would let a later material delete restore the
 * unit a second time. Older material lines are history — once the unit went out again through
 * something else (sales order, RMA replacement, another material) they are left untouched.
 * A billed line is history too: the unit still comes back to stock (any restocking fee is
 * billed separately by the caller), but the invoiced line and its asset links stay as they are.
 * Otherwise mirrors deleteMaterial: un-assigns the unit's asset from that entity and releases
 * any staging line that installed it.
 */
async function removeDeliveringMaterialLine(
  trx: Knex.Transaction,
  tenant: string,
  unitId: string,
  performedBy: string | null,
  user: IUserWithRoles,
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const delivery = await findLatestUnitDelivery(trx, tenant, unitId);
  if (!delivery?.source_doc_id) return;
  if (delivery.source_doc_type !== 'ticket_material' && delivery.source_doc_type !== 'project_material') return;
  const materialId = delivery.source_doc_id;

  const parentType = delivery.source_doc_type === 'ticket_material' ? 'ticket' : 'project';
  const table = parentType === 'ticket' ? 'ticket_materials' : 'project_materials';
  const pk = parentType === 'ticket' ? 'ticket_material_id' : 'project_material_id';
  const parentCol = parentType === 'ticket' ? 'ticket_id' : 'project_id';

  const material = await db.table(table)
    .where({ [pk]: materialId })
    .forUpdate()
    .first('is_billed', parentCol);
  // The line was already removed, or it is billed: leave the invoiced history alone.
  if (!material || material.is_billed) return;
  if (!(await hasPermission(user, parentType, 'update'))) {
    throw new Error(`Permission denied: ${parentType} update required`);
  }
  if (parentType === 'ticket') {
    await authorizeTicketRecordAccess({
      trx,
      tenant,
      user,
      ticketId: material[parentCol],
      action: 'update',
    });
  }

  // Release the staging reference before deleting the material: its foreign key
  // does not cascade.
  if (parentType === 'project') {
    await db.table('project_staging_lines')
      .where({ project_material_id: materialId })
      .update({
        status: 'released',
        project_material_id: null,
        released_at: trx.fn.now(),
        released_by: performedBy,
        updated_at: trx.fn.now(),
      });
  }
  await db.table(table).where(pk, materialId).del();
  await detachDeliveredAssetAssociation(trx, tenant, unitId, parentType, material[parentCol]);

  const base = parentType === 'ticket' ? '/msp/tickets' : '/msp/projects';
  revalidatePath(`${base}/${material[parentCol]}`);
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
        await assertLocationWritable(trx, tenant, user.user_id, targetLocation);
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

        // The unit may still sit on a ticket/project as an unbilled material line (the
        // common MSP "put it back" flow). This restock IS the stock reversal, so that
        // line is removed here — otherwise a later material delete would double-restore
        // stock. Billed lines and older deliveries are left as history.
        await removeDeliveringMaterialLine(trx, tenant, input.unit_id, user.user_id, user);

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
      await assertLocationWritable(trx, tenant, user.user_id, input.location_id);
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
