import { z } from 'zod';

const tenantSchema = z.string().min(1).describe('Tenant ID');
const uuidSchema = (label: string) => z.string().uuid().describe(label);
const optionalUuidSchema = (label: string) => z.string().uuid().nullable().optional().describe(label);

const eventTimestampSchema = z.string().datetime().optional();
const changedFieldsSchema = z.array(z.string()).optional();

export const inventoryStockLowEventPayloadSchema = z.object({
  tenant: tenantSchema,
  service_id: uuidSchema('Service ID'),
  service_name: z.string().min(1),
  sku: z.string().nullable().optional(),
  location_id: uuidSchema('Stock location ID'),
  location_name: z.string().min(1),
  on_hand: z.number(),
  reorder_point: z.number(),
}).describe('Payload for INVENTORY_STOCK_LOW');

export type InventoryStockLowEventPayload = z.infer<typeof inventoryStockLowEventPayloadSchema>;

export const inventoryPoReceivedEventPayloadSchema = z.object({
  tenant: tenantSchema,
  po_id: uuidSchema('Purchase order ID'),
  po_number: z.string().min(1),
  vendor_id: optionalUuidSchema('Vendor ID'),
  vendor_name: z.string().nullable().optional(),
  received_line_count: z.number().int().nonnegative(),
}).describe('Payload for INVENTORY_PO_RECEIVED');

export type InventoryPoReceivedEventPayload = z.infer<typeof inventoryPoReceivedEventPayloadSchema>;

export const inventorySoFulfilledEventPayloadSchema = z.object({
  tenant: tenantSchema,
  so_id: uuidSchema('Sales order ID'),
  so_number: z.string().min(1),
  client_id: optionalUuidSchema('Client ID'),
  fulfilled_line_count: z.number().int().nonnegative(),
  drop_ship: z.boolean(),
}).describe('Payload for INVENTORY_SO_FULFILLED');

export type InventorySoFulfilledEventPayload = z.infer<typeof inventorySoFulfilledEventPayloadSchema>;

export const inventoryRmaCreatedEventPayloadSchema = z.object({
  tenant: tenantSchema,
  rma_id: uuidSchema('RMA ID'),
  rma_reference: z.string().nullable().optional(),
  client_id: optionalUuidSchema('Client ID'),
  service_id: optionalUuidSchema('Service ID'),
  serial_number: z.string().nullable().optional(),
}).describe('Payload for INVENTORY_RMA_CREATED');

export type InventoryRmaCreatedEventPayload = z.infer<typeof inventoryRmaCreatedEventPayloadSchema>;

export const inventorySalesOrderSearchEventPayloadSchema = z.object({
  tenant: tenantSchema,
  so_id: uuidSchema('Sales order ID'),
  user_id: z.string().uuid().optional(),
  changed_fields: changedFieldsSchema,
  timestamp: eventTimestampSchema,
}).describe('Payload for inventory sales order search events');

export type InventorySalesOrderSearchEventPayload = z.infer<typeof inventorySalesOrderSearchEventPayloadSchema>;

export const inventoryPurchaseOrderSearchEventPayloadSchema = z.object({
  tenant: tenantSchema,
  po_id: uuidSchema('Purchase order ID'),
  user_id: z.string().uuid().optional(),
  changed_fields: changedFieldsSchema,
  timestamp: eventTimestampSchema,
}).describe('Payload for inventory purchase order search events');

export type InventoryPurchaseOrderSearchEventPayload = z.infer<typeof inventoryPurchaseOrderSearchEventPayloadSchema>;

export const inventorySalesOrderCreatedEventPayloadSchema = inventorySalesOrderSearchEventPayloadSchema
  .describe('Payload for INVENTORY_SALES_ORDER_CREATED');
export const inventorySalesOrderUpdatedEventPayloadSchema = inventorySalesOrderSearchEventPayloadSchema
  .describe('Payload for INVENTORY_SALES_ORDER_UPDATED');
export const inventorySalesOrderDeletedEventPayloadSchema = inventorySalesOrderSearchEventPayloadSchema
  .describe('Payload for INVENTORY_SALES_ORDER_DELETED');

export const inventoryPurchaseOrderCreatedEventPayloadSchema = inventoryPurchaseOrderSearchEventPayloadSchema
  .describe('Payload for INVENTORY_PURCHASE_ORDER_CREATED');
export const inventoryPurchaseOrderUpdatedEventPayloadSchema = inventoryPurchaseOrderSearchEventPayloadSchema
  .describe('Payload for INVENTORY_PURCHASE_ORDER_UPDATED');
export const inventoryPurchaseOrderDeletedEventPayloadSchema = inventoryPurchaseOrderSearchEventPayloadSchema
  .describe('Payload for INVENTORY_PURCHASE_ORDER_DELETED');

const inventoryTransferLifecycleEventPayloadSchema = z.object({
  tenant: tenantSchema,
  transfer_id: uuidSchema('Stock transfer ID'),
  from_location_id: uuidSchema('Source stock location ID'),
  to_location_id: uuidSchema('Destination stock location ID'),
  line_count: z.number().int().nonnegative(),
  user_id: z.string().uuid().optional(),
  timestamp: eventTimestampSchema,
});

export const inventoryTransferDispatchedEventPayloadSchema = inventoryTransferLifecycleEventPayloadSchema
  .describe('Payload for INVENTORY_TRANSFER_DISPATCHED');
export type InventoryTransferDispatchedEventPayload = z.infer<
  typeof inventoryTransferDispatchedEventPayloadSchema
>;

export const inventoryTransferReceivedEventPayloadSchema = inventoryTransferLifecycleEventPayloadSchema
  .describe('Payload for INVENTORY_TRANSFER_RECEIVED');
export type InventoryTransferReceivedEventPayload = z.infer<
  typeof inventoryTransferReceivedEventPayloadSchema
>;

const inventoryCountLifecycleEventPayloadSchema = z.object({
  tenant: tenantSchema,
  session_id: uuidSchema('Cycle count session ID'),
  location_id: uuidSchema('Stock location ID'),
  line_count: z.number().int().nonnegative(),
  counted_line_count: z.number().int().nonnegative(),
  variance_line_count: z.number().int().nonnegative(),
  variance_quantity: z.number().int(),
  user_id: z.string().uuid().optional(),
  timestamp: eventTimestampSchema,
});

export const inventoryCountSubmittedEventPayloadSchema = inventoryCountLifecycleEventPayloadSchema
  .describe('Payload for INVENTORY_COUNT_SUBMITTED');
export type InventoryCountSubmittedEventPayload = z.infer<typeof inventoryCountSubmittedEventPayloadSchema>;

export const inventoryCountApprovedEventPayloadSchema = inventoryCountLifecycleEventPayloadSchema.extend({
  adjustment_line_count: z.number().int().nonnegative(),
  stale_line_count: z.number().int().nonnegative(),
  uncounted_line_count: z.number().int().nonnegative(),
}).describe('Payload for INVENTORY_COUNT_APPROVED');
export type InventoryCountApprovedEventPayload = z.infer<typeof inventoryCountApprovedEventPayloadSchema>;

export const inventoryStockUnitSearchEventPayloadSchema = z.object({
  tenant: tenantSchema,
  unit_id: uuidSchema('Stock unit ID'),
  service_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  changed_fields: changedFieldsSchema,
  timestamp: eventTimestampSchema,
}).describe('Payload for inventory stock unit search events');

export type InventoryStockUnitSearchEventPayload = z.infer<typeof inventoryStockUnitSearchEventPayloadSchema>;
