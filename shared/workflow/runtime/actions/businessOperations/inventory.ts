import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  requirePermission,
  rethrowAsStandardError,
  uuidSchema,
  withTenantTransaction,
  writeRunAudit,
} from './shared';

const stockUnitStatusSchema = z.enum([
  'in_stock',
  'allocated',
  'in_transit',
  'on_loan',
  'delivered',
  'returned',
  'in_rma',
  'retired',
]);

const availabilityRowSchema = z.object({
  location_id: uuidSchema,
  location_name: z.string(),
  quantity_on_hand: z.number(),
  reserved_quantity: z.number(),
  held_quantity: z.number(),
  available: z.number(),
  reorder_point: z.number().nullable(),
  below_reorder: z.boolean(),
});

const unitSummarySchema = z.object({
  unit_id: uuidSchema,
  service_id: uuidSchema,
  product_name: z.string().nullable(),
  serial_number: z.string(),
  mac_address: z.string().nullable(),
  status: stockUnitStatusSchema,
  location_id: uuidSchema.nullable(),
  location_name: z.string().nullable(),
  client_id: uuidSchema.nullable(),
  client_name: z.string().nullable(),
});

const purchaseOrderLineInputSchema = z.object({
  service_id: uuidSchema.describe('Inventory product service id'),
  quantity: z.number().int().positive(),
  unit_cost: z.number().int().nonnegative().optional(),
}).strict();

async function loadInventoryCore(): Promise<any> {
  // Keep shared independent from the inventory package at build time: inventory
  // already depends on shared, while deployed workflow runtimes compose both.
  const moduleName = '@alga-psa/inventory/lib';
  return import(moduleName);
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function availabilityRow(row: Record<string, any>) {
  const reorderPoint = row.reorder_point == null ? null : numberValue(row.reorder_point);
  const available = numberValue(row.available);
  return availabilityRowSchema.parse({
    location_id: row.location_id,
    location_name: String(row.location_name ?? ''),
    quantity_on_hand: numberValue(row.quantity_on_hand),
    reserved_quantity: numberValue(row.reserved_quantity),
    held_quantity: numberValue(row.held_quantity),
    available,
    reorder_point: reorderPoint,
    below_reorder: reorderPoint !== null && available <= reorderPoint,
  });
}

function unitSummary(row: Record<string, any>) {
  return unitSummarySchema.parse({
    unit_id: row.unit_id,
    service_id: row.service_id,
    product_name: row.product_name ?? null,
    serial_number: String(row.serial_number ?? ''),
    mac_address: row.mac_address ?? null,
    status: row.status,
    location_id: row.location_id ?? null,
    location_name: row.location_name ?? null,
    client_id: row.client_id ?? null,
    client_name: row.client_name ?? null,
  });
}

async function publishPendingInventoryEvent(
  ctx: { logger?: { warn: (message: string, meta?: unknown) => void } },
  eventType: string,
  payload: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!payload) return;
  try {
    const inventory = await loadInventoryCore();
    await inventory.publishInventoryEvent(eventType, inventory.timestampPayload(payload));
  } catch (error) {
    ctx.logger?.warn(`workflow inventory event publication failed: ${eventType}`, { error });
  }
}

export function registerInventoryActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'inventory.get_availability',
    version: 1,
    inputSchema: z.object({
      service_id: uuidSchema.describe('Inventory product service id'),
    }).strict(),
    outputSchema: z.object({ locations: z.array(availabilityRowSchema) }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Get Inventory Availability',
      category: 'Business Operations',
      description: 'Get on-hand, reserved, held, available, and reorder state by stock location',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'inventory', action: 'read' });
      try {
        const inventory = await loadInventoryCore();
        const rows = await inventory.queryStockLevelsForProduct(tx.trx, tx.tenantId, input.service_id);
        return { locations: rows.map(availabilityRow) };
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'inventory.find_units',
    version: 1,
    inputSchema: z.object({
      serial: z.string().trim().min(1).optional(),
      mac: z.string().trim().min(1).optional(),
      status: stockUnitStatusSchema.optional(),
      location_id: uuidSchema.optional(),
      service_id: uuidSchema.optional(),
      limit: z.number().int().positive().max(50).default(25),
    }).strict(),
    outputSchema: z.object({ units: z.array(unitSummarySchema) }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Find Inventory Units',
      category: 'Business Operations',
      description: 'Find serialized stock units by serial, MAC address, status, location, or product',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'inventory', action: 'read' });
      try {
        const inventory = await loadInventoryCore();
        const rows = await inventory.findStockUnits(tx.trx, tx.tenantId, input);
        return { units: rows.map(unitSummary) };
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'inventory.adjust_stock',
    version: 1,
    inputSchema: z.object({
      service_id: uuidSchema.describe('Inventory product service id'),
      location_id: uuidSchema.describe('Stock location id'),
      quantity_delta: z.number().int().refine((value) => value !== 0, 'quantity_delta must be non-zero'),
      reason: z.string().trim().min(1),
    }).strict(),
    outputSchema: z.object({
      movement_id: uuidSchema.optional(),
      new_on_hand: z.number(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Adjust Inventory Stock',
      category: 'Business Operations',
      description: 'Adjust stock at one location. Movement performed_by attribution is the workflow publisher (run actor).',
    },
    handler: async (input, ctx) => {
      const outcome = await withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'inventory', action: 'update' });
        try {
          const inventory = await loadInventoryCore();
          const core = await inventory.adjustStockCore(tx.trx, tx.tenantId, tx.actorUserId, {
            service_id: input.service_id,
            location_id: input.location_id,
            delta: input.quantity_delta,
            reason: input.reason,
          });
          const levels = await inventory.queryStockLevelsForProduct(tx.trx, tx.tenantId, input.service_id);
          const level = levels.find((row: Record<string, any>) => row.location_id === input.location_id);
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:inventory.adjust_stock',
            changedData: {
              service_id: input.service_id,
              location_id: input.location_id,
              quantity_delta: input.quantity_delta,
              reason: input.reason,
            },
            details: { action_id: 'inventory.adjust_stock', action_version: 1 },
          });
          return {
            output: {
              movement_id: core.movements[0]?.movement_id,
              new_on_hand: numberValue(level?.quantity_on_hand),
            },
            pendingStockLow: core.pending_stock_low_event,
          };
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }
      });
      await publishPendingInventoryEvent(ctx, 'INVENTORY_STOCK_LOW', outcome.pendingStockLow);
      return outcome.output;
    },
  });

  registry.register({
    id: 'inventory.create_purchase_order_draft',
    version: 1,
    inputSchema: z.object({
      vendor_id: uuidSchema.describe('Vendor id'),
      lines: z.array(purchaseOrderLineInputSchema).min(1),
      ship_to_location_id: uuidSchema.optional(),
    }).strict(),
    outputSchema: z.object({ po_id: uuidSchema, po_number: z.string().min(1) }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Create Purchase Order Draft',
      category: 'Business Operations',
      description: 'Create a numbered draft purchase order for a vendor',
    },
    handler: async (input, ctx) => {
      const outcome = await withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'purchase_order', action: 'create' });
        try {
          const inventory = await loadInventoryCore();
          const core = await inventory.createPurchaseOrderDraftCore(
            tx.trx,
            tx.tenantId,
            tx.actorUserId,
            {
              vendor_id: input.vendor_id,
              ship_to_location_id: input.ship_to_location_id,
              lines: input.lines.map((line) => ({
                service_id: line.service_id,
                quantity_ordered: line.quantity,
                unit_cost: line.unit_cost,
              })),
            },
          );
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:inventory.create_purchase_order_draft',
            changedData: { po_id: core.purchase_order.po_id, line_count: input.lines.length },
            details: { action_id: 'inventory.create_purchase_order_draft', action_version: 1 },
          });
          return {
            output: {
              po_id: core.purchase_order.po_id,
              po_number: core.purchase_order.po_number,
            },
            createdEvent: core.purchase_order_created_event,
          };
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }
      });
      await publishPendingInventoryEvent(
        ctx,
        'INVENTORY_PURCHASE_ORDER_CREATED',
        outcome.createdEvent,
      );
      return outcome.output;
    },
  });
}
