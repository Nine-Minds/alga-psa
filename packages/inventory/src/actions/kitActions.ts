'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IKitComponent, ISalesOrderLine, KitPricingMode } from '@alga-psa/types';
import { kitActionErrorFrom, type KitActionError } from '../lib/kitActionErrors';

/**
 * Kit (bundle) management — single-level bill of materials (F102).
 *
 * A kit is a `service_catalog` product flagged `product_inventory_settings.is_kit = true`
 * whose `kit_components` rows name the products that make it up. On a sales order a kit line
 * EXPLODES into one parent line plus one editable child line per component
 * (`parent_so_line_id` set). Components may be stocked or non-stocked; non-stocked components
 * still get a line but never decrement stock at fulfillment (F105). Multi-level BOM (a kit
 * containing a kit) is explicitly rejected here and deferred. See design §6.I.
 */

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

async function withKitActionErrors<T>(work: () => Promise<T>): Promise<T | KitActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = kitActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

/** Assert the service is flagged as a kit; throws otherwise. */
async function assertIsKit(trx: Knex.Transaction, tenant: string, kitServiceId: string): Promise<void> {
  const settings = await trx('product_inventory_settings')
    .where({ tenant, service_id: kitServiceId })
    .select('is_kit')
    .first();
  if (!settings) throw new Error('Inventory not enabled for this product; cannot manage kit components');
  if (!settings.is_kit) throw new Error('Product is not flagged as a kit (is_kit=false); set the kit flag first');
}

/**
 * Reject any component that is itself a kit (single-level BOM only, F102), or that is the
 * kit itself. A component with no inventory settings is allowed (non-stocked line, F105).
 */
async function assertComponentAllowed(
  trx: Knex.Transaction,
  tenant: string,
  kitServiceId: string,
  componentServiceId: string,
): Promise<void> {
  if (componentServiceId === kitServiceId) throw new Error('A kit cannot contain itself');
  const svc = await trx('service_catalog')
    .where({ tenant, service_id: componentServiceId })
    .select('service_id')
    .first();
  if (!svc) throw new Error('Component service not found');
  const compSettings = await trx('product_inventory_settings')
    .where({ tenant, service_id: componentServiceId })
    .select('is_kit')
    .first();
  if (compSettings?.is_kit) {
    throw new Error('A kit cannot contain another kit (single-level BOM only)');
  }
}

function normalizeQuantity(quantity: number): number {
  const q = Math.trunc(Number(quantity));
  if (!Number.isFinite(q) || q <= 0) throw new Error('Component quantity must be a positive integer');
  return q;
}

/** List a kit's components, merged with catalog name/sku for display. */
export const listKitComponents = withAuth(
  async (
    user,
    { tenant },
    kitServiceId: string,
  ): Promise<Array<IKitComponent & { service_name?: string; sku?: string | null }> | KitActionError> => {
    return withKitActionErrors(async () => {
      await requireInvPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        return trx('kit_components as kc')
          .join('service_catalog as sc', function () {
            this.on('kc.component_service_id', '=', 'sc.service_id').andOn('kc.tenant', '=', 'sc.tenant');
          })
          .where({ 'kc.tenant': tenant, 'kc.kit_service_id': kitServiceId })
          .select('kc.*', 'sc.service_name', 'sc.sku')
          .orderBy('sc.service_name', 'asc') as any;
      });
    });
  },
);

/**
 * Replace the full set of a kit's components in one atomic operation (F102).
 * Rejects any component that is itself a kit.
 */
export const setKitComponents = withAuth(
  async (
    user,
    { tenant },
    kitServiceId: string,
    components: Array<{ component_service_id: string; quantity: number }>,
  ): Promise<IKitComponent[] | KitActionError> => {
    return withKitActionErrors(async () => {
      await requireInvPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        await assertIsKit(trx, tenant, kitServiceId);

        // Collapse duplicate component ids (summing quantities) and validate each.
        const merged = new Map<string, number>();
        for (const c of components ?? []) {
          const qty = normalizeQuantity(c.quantity);
          merged.set(c.component_service_id, (merged.get(c.component_service_id) ?? 0) + qty);
        }
        for (const componentServiceId of merged.keys()) {
          await assertComponentAllowed(trx, tenant, kitServiceId, componentServiceId);
        }

        await trx('kit_components').where({ tenant, kit_service_id: kitServiceId }).del();

        const rows = Array.from(merged.entries()).map(([componentServiceId, quantity]) => ({
          tenant,
          kit_service_id: kitServiceId,
          component_service_id: componentServiceId,
          quantity,
        }));
        if (rows.length === 0) return [];
        const inserted = await trx('kit_components').insert(rows).returning('*');
        return inserted as IKitComponent[];
      });
    });
  },
);

/** Add (or update the quantity of) a single component on a kit. */
export const addKitComponent = withAuth(
  async (user, { tenant }, kitServiceId: string, componentServiceId: string, quantity: number): Promise<IKitComponent | KitActionError> => {
    return withKitActionErrors(async () => {
      await requireInvPerm(user, 'update');
      const qty = normalizeQuantity(quantity);
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        await assertIsKit(trx, tenant, kitServiceId);
        await assertComponentAllowed(trx, tenant, kitServiceId, componentServiceId);
        const [row] = await trx('kit_components')
          .insert({
            tenant,
            kit_service_id: kitServiceId,
            component_service_id: componentServiceId,
            quantity: qty,
          })
          .onConflict(['tenant', 'kit_service_id', 'component_service_id'])
          .merge({ quantity: qty, updated_at: trx.fn.now() })
          .returning('*');
        return row as IKitComponent;
      });
    });
  },
);

/** Remove a single component from a kit. */
export const removeKitComponent = withAuth(
  async (user, { tenant }, kitServiceId: string, componentServiceId: string): Promise<void | KitActionError> => {
    return withKitActionErrors(async () => {
      await requireInvPerm(user, 'update');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        await trx('kit_components')
          .where({ tenant, kit_service_id: kitServiceId, component_service_id: componentServiceId })
          .del();
      });
    });
  },
);

export interface ExplodedKitLines {
  parentLine: ISalesOrderLine;
  componentLines: ISalesOrderLine[];
}

/**
 * Explode a kit onto a sales order: insert a parent line for the kit plus one child line per
 * component (`parent_so_line_id` = parent line id, `quantity_ordered` = component.quantity ×
 * kitQuantity). Non-stocked components still get a line (F105) — fulfillment decides whether
 * to decrement stock. This is the reusable primitive `salesOrderActions` calls; it operates
 * inside the caller's transaction (no auth/permission check — the caller is authorized for the
 * SO mutation). See design §6.I.
 */
export async function explodeKitOntoSalesOrder(
  trx: Knex.Transaction,
  tenant: string,
  soId: string,
  kitServiceId: string,
  kitQuantity: number,
  basePrice: number,
): Promise<ExplodedKitLines> {
  const qty = normalizeQuantity(kitQuantity);
  await assertIsKit(trx, tenant, kitServiceId);

  const components = (await trx('kit_components')
    .where({ tenant, kit_service_id: kitServiceId })
    .orderBy('component_service_id', 'asc')) as IKitComponent[];
  if (components.length === 0) throw new Error('Kit has no components defined; cannot explode onto sales order');

  // Parent line carries the kit's price; component lines are priced at the kit level (0).
  const [parentLine] = await trx('sales_order_lines')
    .insert({
      tenant,
      so_id: soId,
      service_id: kitServiceId,
      quantity_ordered: qty,
      unit_price: basePrice,
      fulfillment_type: 'from_stock',
      parent_so_line_id: null,
    })
    .returning('*');

  const componentRows = components.map((c) => ({
    tenant,
    so_id: soId,
    service_id: c.component_service_id,
    quantity_ordered: c.quantity * qty,
    unit_price: 0,
    fulfillment_type: 'from_stock',
    parent_so_line_id: (parentLine as ISalesOrderLine).so_line_id,
  }));
  const componentLines = (await trx('sales_order_lines').insert(componentRows).returning('*')) as ISalesOrderLine[];

  return { parentLine: parentLine as ISalesOrderLine, componentLines };
}

/**
 * Re-scale a previously exploded kit on a sales order to a new kit quantity (F106): updates
 * the parent line and proportionally updates each child line's `quantity_ordered` from the
 * kit's bill of materials (component.quantity × newKitQty).
 */
export const scaleKitLineQuantity = withAuth(
  async (user, { tenant }, parentSoLineId: string, newKitQty: number): Promise<ExplodedKitLines | KitActionError> => {
    return withKitActionErrors(async () => {
      await requireInvPerm(user, 'update');
      const qty = normalizeQuantity(newKitQty);
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const parent = await trx('sales_order_lines')
          .where({ tenant, so_line_id: parentSoLineId })
          .first();
        if (!parent) throw new Error('Parent sales order line not found');
        if (parent.parent_so_line_id) throw new Error('Line is itself a kit component; pass the parent kit line');

        const components = (await trx('kit_components')
          .where({ tenant, kit_service_id: parent.service_id })) as IKitComponent[];
        const perComponent = new Map(components.map((c) => [c.component_service_id, c.quantity]));

        const [updatedParent] = await trx('sales_order_lines')
          .where({ tenant, so_line_id: parentSoLineId })
          .update({ quantity_ordered: qty, updated_at: trx.fn.now() })
          .returning('*');

        const childLines = (await trx('sales_order_lines')
          .where({ tenant, parent_so_line_id: parentSoLineId })) as ISalesOrderLine[];
        const updatedChildren: ISalesOrderLine[] = [];
        for (const child of childLines) {
          const unit = perComponent.get(child.service_id);
          if (unit === undefined) continue; // component no longer in BOM; leave as-is
          const [row] = await trx('sales_order_lines')
            .where({ tenant, so_line_id: child.so_line_id })
            .update({ quantity_ordered: unit * qty, updated_at: trx.fn.now() })
            .returning('*');
          updatedChildren.push(row as ISalesOrderLine);
        }

        return { parentLine: updatedParent as ISalesOrderLine, componentLines: updatedChildren };
      });
    });
  },
);

/**
 * Compute a kit's price in cents (F108):
 * - `kit_pricing_mode = 'sum'`  → Σ(component `service_catalog.default_rate` × component quantity)
 * - `kit_pricing_mode = 'fixed'`→ `product_inventory_settings.kit_fixed_price`
 */
export const computeKitPrice = withAuth(
  async (user, { tenant }, kitServiceId: string, _currency?: string): Promise<number | KitActionError> => {
    return withKitActionErrors(async () => {
      await requireInvPerm(user, 'read');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
        const settings = await trx('product_inventory_settings')
          .where({ tenant, service_id: kitServiceId })
          .select('is_kit', 'kit_pricing_mode', 'kit_fixed_price')
          .first();
        if (!settings) throw new Error('Inventory not enabled for this product');
        if (!settings.is_kit) throw new Error('Product is not flagged as a kit (is_kit=false)');

        const mode: KitPricingMode = settings.kit_pricing_mode ?? 'sum';
        if (mode === 'fixed') {
          return Number(settings.kit_fixed_price ?? 0);
        }

        const components = (await trx('kit_components')
          .where({ tenant, kit_service_id: kitServiceId })) as IKitComponent[];
        let total = 0;
        for (const c of components) {
          const svc = await trx('service_catalog')
            .where({ tenant, service_id: c.component_service_id })
            .select('default_rate')
            .first();
          const rate = Number(svc?.default_rate ?? 0);
          total += rate * c.quantity;
        }
        return total;
      });
    });
  },
);
