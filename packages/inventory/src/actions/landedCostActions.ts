'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IPoLandedCost, IPurchaseOrderLine } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { recordStockMovement } from '../lib';

// NOTE: 'use server' file — export ONLY async functions (+ erased types).

/**
 * Landed cost (F069–F074). Entries (freight/duty/other) attach to a PO and are
 * APPLIED as a separate idempotent step — costs usually arrive after the goods
 * (D8). Application allocates each unapplied entry across the PO's RECEIVED
 * quantities (by line value or quantity), then:
 *   - non-serialized: injects the allocated value into the moving average
 *     (cost-only — total on-hand quantity is untouched), and
 *   - serialized: bumps unit_cost on not-yet-consumed units from this PO
 *     (delivered/retired units keep the COGS already recognized).
 * A quantity-0 'adjust' movement records the change in the append-only ledger.
 */

async function requirePoPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'purchase_order', action))) {
    throw new Error(`Permission denied: purchase_order ${action} required`);
  }
}

export type LandedCostActionError = ActionMessageError | ActionPermissionError;

function landedCostActionErrorFrom(error: unknown): LandedCostActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'amount must be a positive integer (cents)':
        return actionError('Landed cost amount must be greater than zero.');
      case 'Purchase order not found':
        return actionError('Purchase order not found. It may have been updated or deleted. Please refresh and try again.');
      case 'Cannot add landed cost to a cancelled purchase order':
        return actionError('Landed cost cannot be added to a cancelled purchase order.');
      case 'An applied landed-cost entry cannot be removed':
        return actionError('Applied landed-cost entries cannot be removed.');
      case 'Nothing has been received on this purchase order yet — receive first, then apply landed cost':
        return actionError('Receive at least one purchase order line before applying landed cost.');
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected landed-cost records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This landed-cost update conflicts with an existing record. Please refresh and try again.');
  }

  return null;
}

async function withLandedCostActionErrors<T>(work: () => Promise<T>): Promise<T | LandedCostActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = landedCostActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

export const listPoLandedCosts = withAuth(
  async (user, { tenant }, poId: string): Promise<IPoLandedCost[] | LandedCostActionError> => {
    return withLandedCostActionErrors(async () => {
      await requirePoPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        return (await trx('po_landed_costs')
          .where({ tenant, po_id: poId })
          .orderBy('created_at', 'asc')) as IPoLandedCost[];
      });
    });
  },
);

export const addPoLandedCost = withAuth(
  async (
    user,
    { tenant },
    poId: string,
    input: {
      cost_type: 'freight' | 'duty' | 'other';
      amount: number; // cents
      allocation_method?: 'value' | 'quantity';
      description?: string | null;
    },
  ): Promise<IPoLandedCost | LandedCostActionError> => {
    return withLandedCostActionErrors(async () => {
      await requirePoPerm(user, 'update');
      if (!Number.isInteger(input.amount) || input.amount <= 0) {
        throw new Error('amount must be a positive integer (cents)');
      }
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const po = await trx('purchase_orders').where({ tenant, po_id: poId }).first();
        if (!po) throw new Error('Purchase order not found');
        if (po.status === 'cancelled') throw new Error('Cannot add landed cost to a cancelled purchase order');
        const [row] = await trx('po_landed_costs')
          .insert({
            tenant,
            po_id: poId,
            cost_type: input.cost_type,
            amount: input.amount,
            currency_code: po.currency_code ?? 'USD', // landed costs share the PO currency
            allocation_method: input.allocation_method ?? 'value',
            description: input.description ?? null,
          })
          .returning('*');
        return row as IPoLandedCost;
      });
    });
  },
);

export const removePoLandedCost = withAuth(
  async (user, { tenant }, landedCostId: string): Promise<{ removed: boolean } | LandedCostActionError> => {
    return withLandedCostActionErrors(async () => {
      await requirePoPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const entry = await trx('po_landed_costs').where({ tenant, landed_cost_id: landedCostId }).forUpdate().first();
        if (!entry) return { removed: false };
        if (entry.applied) throw new Error('An applied landed-cost entry cannot be removed');
        await trx('po_landed_costs').where({ tenant, landed_cost_id: landedCostId }).del();
        return { removed: true };
      });
    });
  },
);

export interface LandedCostAllocation {
  po_line_id: string;
  service_id: string;
  allocated_cents: number;
  per_unit_cents: number;
}

export interface ApplyLandedCostsResult {
  applied_entries: number;
  total_applied_cents: number;
  allocations: LandedCostAllocation[];
}

export const applyPoLandedCosts = withAuth(
  async (user, { tenant }, poId: string): Promise<ApplyLandedCostsResult | LandedCostActionError> => {
    return withLandedCostActionErrors(async () => {
      await requirePoPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        // PO header lock serializes concurrent applies; the `applied` flag makes the
        // whole operation idempotent (F071).
        const po = await trx('purchase_orders').where({ tenant, po_id: poId }).forUpdate().first();
        if (!po) throw new Error('Purchase order not found');

        const entries = (await trx('po_landed_costs')
          .where({ tenant, po_id: poId, applied: false })
          .forUpdate()) as IPoLandedCost[];
        if (entries.length === 0) return { applied_entries: 0, total_applied_cents: 0, allocations: [] };

        const lines = (await trx('purchase_order_lines')
          .where({ tenant, po_id: poId })
          .andWhere('quantity_received', '>', 0)) as IPurchaseOrderLine[];
        if (lines.length === 0) {
          throw new Error('Nothing has been received on this purchase order yet — receive first, then apply landed cost');
        }

        // Accumulate allocations per line across all unapplied entries.
        const allocatedByLine = new Map<string, number>();
        const totalValue = lines.reduce((s, l) => s + Number(l.unit_cost) * Number(l.quantity_received), 0);
        const totalQty = lines.reduce((s, l) => s + Number(l.quantity_received), 0);
        let totalApplied = 0;

        for (const entry of entries) {
          const amount = Number(entry.amount);
          totalApplied += amount;
          let remainder = amount;
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            const weight =
              entry.allocation_method === 'quantity'
                ? Number(l.quantity_received) / totalQty
                : totalValue > 0
                  ? (Number(l.unit_cost) * Number(l.quantity_received)) / totalValue
                  : Number(l.quantity_received) / totalQty;
            // Last line takes the rounding remainder so the cents always add up.
            const share = i === lines.length - 1 ? remainder : Math.round(amount * weight);
            remainder -= share;
            allocatedByLine.set(l.po_line_id, (allocatedByLine.get(l.po_line_id) ?? 0) + share);
          }
        }

        const allocations: LandedCostAllocation[] = [];
        for (const l of lines) {
          const allocated = allocatedByLine.get(l.po_line_id) ?? 0;
          if (allocated === 0) continue;
          const perUnit = Math.round(allocated / Number(l.quantity_received));

          const settings = await trx('product_inventory_settings')
            .where({ tenant, service_id: l.service_id })
            .forUpdate()
            .first();
          if (settings?.is_serialized) {
            // Bump the recorded cost of this PO's not-yet-consumed units (F073).
            await trx('stock_units')
              .where({ tenant, service_id: l.service_id, source_po_id: poId })
              .whereIn('status', ['in_stock', 'allocated', 'in_transit', 'on_loan'])
              .update({ unit_cost: trx.raw('COALESCE(unit_cost, 0) + ?', [perUnit]), updated_at: trx.fn.now() });
          }
          if (settings && !settings.is_serialized) {
            // Cost-only moving-average injection (F072): value is added, quantity isn't.
            const sumRow = await trx('stock_levels')
              .where({ tenant, service_id: l.service_id })
              .sum<{ s: string }>('quantity_on_hand as s')
              .first();
            const onHand = Number(sumRow?.s ?? 0);
            if (onHand > 0) {
              const oldAvg = Number(settings.average_cost ?? 0);
              const newAvg = Math.round((onHand * oldAvg + allocated) / onHand);
              await trx('product_inventory_settings')
                .where({ tenant, service_id: l.service_id })
                .update({ average_cost: newAvg, updated_at: trx.fn.now() });
            }
          }

          // Quantity-0 audit line in the append-only ledger (no on-hand effect).
          await recordStockMovement(trx, tenant, {
            movement_type: 'adjust',
            service_id: l.service_id,
            quantity: 0,
            unit_cost: allocated,
            cost_currency: po.currency_code ?? 'USD',
            reason: `landed_cost: PO ${po.po_number} — ${allocated} cents allocated (${perUnit}/unit)`,
            source_doc_type: 'purchase_order',
            source_doc_id: poId,
            performed_by: user.user_id,
          });

          allocations.push({
            po_line_id: l.po_line_id,
            service_id: l.service_id,
            allocated_cents: allocated,
            per_unit_cents: perUnit,
          });
        }

        await trx('po_landed_costs')
          .where({ tenant, po_id: poId, applied: false })
          .update({ applied: true, applied_at: trx.fn.now(), updated_at: trx.fn.now() });

        return { applied_entries: entries.length, total_applied_cents: totalApplied, allocations };
      });
    });
  },
);
