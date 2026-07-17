import { z } from 'zod';

const uuidSchema = z.string().uuid();
const nullableDateSchema = z.union([z.string(), z.date()]).nullable().optional();

export const stockUnitStatusSchema = z.enum([
  'in_stock',
  'allocated',
  'in_transit',
  'on_loan',
  'delivered',
  'returned',
  'in_rma',
  'retired',
]);

export const inventoryProductSchema = z.object({
  service_id: uuidSchema,
  service_name: z.string(),
  sku: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  is_serialized: z.boolean(),
  track_stock: z.boolean().optional().default(true),
  unit_of_measure: z.string().nullable().optional(),
});

export const stockLevelSchema = z.object({
  service_id: uuidSchema,
  service_name: z.string().optional(),
  sku: z.string().nullable().optional(),
  location_id: uuidSchema,
  location_name: z.string().nullable().optional(),
  quantity_on_hand: z.number(),
  reserved_quantity: z.number(),
  held_quantity: z.number(),
  available: z.number(),
  reorder_point: z.number().nullable().optional(),
  is_low_stock: z.boolean().optional(),
});

export const stockLocationSchema = z.object({
  location_id: uuidSchema,
  name: z.string(),
  location_type: z.string(),
  is_default: z.boolean().optional(),
});

export const stockUnitSummarySchema = z.object({
  unit_id: uuidSchema,
  service_id: uuidSchema,
  service_name: z.string().optional(),
  serial_number: z.string(),
  mac_address: z.string().nullable().optional(),
  status: stockUnitStatusSchema,
  location_id: uuidSchema.nullable().optional(),
  location_name: z.string().nullable().optional(),
  client_id: uuidSchema.nullable().optional(),
  client_name: z.string().nullable().optional(),
  warranty_expires_at: nullableDateSchema,
  warranty_term: z.string().nullable().optional(),
});

export const stockMovementSchema = z.object({
  movement_id: uuidSchema,
  movement_type: z.string(),
  quantity: z.number(),
  reason: z.string().nullable().optional(),
  from_location_name: z.string().nullable().optional(),
  to_location_name: z.string().nullable().optional(),
  performed_by_name: z.string().nullable().optional(),
  created_at: z.union([z.string(), z.date()]),
});

export const stockUnitDetailSchema = stockUnitSummarySchema.extend({
  unit_cost: z.number().nullable().optional(),
  cost_currency: z.string().nullable().optional(),
  received_at: nullableDateSchema,
  delivered_at: nullableDateSchema,
  movements: z.array(stockMovementSchema),
});

const productLookupMatchSchema = z.object({
  kind: z.literal('product'),
  product: inventoryProductSchema,
});

const unitLookupMatchSchema = z.object({
  kind: z.literal('unit'),
  unit: stockUnitSummarySchema,
});

export const inventoryLookupResultSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('product'),
    product: inventoryProductSchema,
    levels: z.array(stockLevelSchema),
  }),
  z.object({
    type: z.literal('unit'),
    unit: stockUnitSummarySchema,
    product: inventoryProductSchema,
  }),
  z.object({
    type: z.literal('multi'),
    matches: z.array(z.union([productLookupMatchSchema, unitLookupMatchSchema])).min(2),
  }),
  z.object({
    type: z.literal('none'),
    candidates: z.array(z.union([productLookupMatchSchema, unitLookupMatchSchema])),
  }),
]);

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const optionalUuidQuery = uuidSchema.optional();

export const inventoryLookupQuerySchema = z.object({
  code: z.string().trim().min(1).max(255),
});

export const inventoryStockListQuerySchema = paginationQuerySchema.extend({
  location_id: optionalUuidQuery,
  service_id: optionalUuidQuery,
  low_stock: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  search: z.string().trim().max(255).optional(),
});

export const inventoryUnitListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(255).optional(),
  status: stockUnitStatusSchema.optional(),
  location_id: optionalUuidQuery,
  service_id: optionalUuidQuery,
  client_id: optionalUuidQuery,
});

export const inventoryReceiptSchema = z.object({
  service_id: uuidSchema,
  location_id: uuidSchema,
  quantity: z.number().int().positive(),
  unit_cost: z.number().int().nonnegative().optional(),
  serials: z.array(z.object({
    serial_number: z.string().trim().min(1),
    mac_address: z.string().trim().min(1).optional(),
    warranty_expires_at: z.string().datetime({ offset: true }).optional(),
  })).optional(),
});

export const inventoryAdjustmentSchema = z.object({
  service_id: uuidSchema,
  location_id: uuidSchema,
  quantity_delta: z.number().int().refine((value) => value !== 0, 'quantity_delta must be non-zero'),
  reason: z.string().trim().min(1, 'reason is required'),
});

export const inventoryCountListQuerySchema = paginationQuerySchema.extend({
  location_id: optionalUuidQuery,
  status: z.enum(['draft', 'in_progress', 'review', 'approved', 'cancelled']).optional(),
});

export const inventoryCountStartSchema = z.object({
  location_id: uuidSchema,
});

export const inventoryCountRecordSchema = z.object({
  service_id: uuidSchema,
  counted_quantity: z.number().int().nonnegative(),
});

const purchaseOrderStatusSchema = z.enum([
  'draft',
  'open',
  'partially_received',
  'received',
  'cancelled',
]);

export const inventoryPurchaseOrderListQuerySchema = paginationQuerySchema.extend({
  status: z.string().trim().min(1).transform((value, ctx) => {
    const statuses = value.split(',').map((status) => status.trim()).filter(Boolean);
    const parsed = z.array(purchaseOrderStatusSchema).min(1).safeParse(statuses);
    if (!parsed.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'status contains an invalid purchase-order status' });
      return z.NEVER;
    }
    return parsed.data;
  }).optional(),
});

export const inventoryPoLineReceiveSchema = z.object({
  quantity: z.number().int().positive(),
  location_id: uuidSchema.optional(),
  serials: z.array(z.object({
    serial_number: z.string().trim().min(1),
    mac_address: z.string().trim().min(1).optional(),
    warranty_expires_at: z.string().datetime({ offset: true }).optional(),
  })).optional(),
});

export const inventoryTransferListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['dispatched', 'received', 'cancelled']).optional(),
});

export const inventoryIdParamsSchema = z.object({
  unitId: uuidSchema.optional(),
  sessionId: uuidSchema.optional(),
  poId: uuidSchema.optional(),
  lineId: uuidSchema.optional(),
  transferId: uuidSchema.optional(),
});

export type InventoryReceiptApi = z.infer<typeof inventoryReceiptSchema>;
export type InventoryAdjustmentApi = z.infer<typeof inventoryAdjustmentSchema>;
export type InventoryStockListQuery = z.infer<typeof inventoryStockListQuerySchema>;
export type InventoryUnitListQuery = z.infer<typeof inventoryUnitListQuerySchema>;
export type InventoryCountListQuery = z.infer<typeof inventoryCountListQuerySchema>;
export type InventoryCountRecordApi = z.infer<typeof inventoryCountRecordSchema>;
export type InventoryPurchaseOrderListQuery = z.infer<typeof inventoryPurchaseOrderListQuerySchema>;
export type InventoryPoLineReceiveApi = z.infer<typeof inventoryPoLineReceiveSchema>;
export type InventoryTransferListQuery = z.infer<typeof inventoryTransferListQuerySchema>;
export type InventoryLookupResult = z.infer<typeof inventoryLookupResultSchema>;
