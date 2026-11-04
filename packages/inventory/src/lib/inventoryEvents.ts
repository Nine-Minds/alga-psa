import { type BuiltWorkflowPayload, type WorkflowCatalogEventType } from '@alga-psa/event-schemas';

export type InventoryEventPayload = object;

export type InventoryEventType =
  | 'INVENTORY_STOCK_LOW'
  | 'INVENTORY_PO_RECEIVED'
  | 'INVENTORY_SO_FULFILLED'
  | 'INVENTORY_RMA_CREATED'
  | 'INVENTORY_RMA_UPDATED'
  | 'INVENTORY_SALES_ORDER_CREATED'
  | 'INVENTORY_SALES_ORDER_UPDATED'
  | 'INVENTORY_SALES_ORDER_DELETED'
  | 'INVENTORY_PURCHASE_ORDER_CREATED'
  | 'INVENTORY_PURCHASE_ORDER_UPDATED'
  | 'INVENTORY_PURCHASE_ORDER_DELETED'
  | 'INVENTORY_STOCK_UNIT_CREATED'
  | 'INVENTORY_STOCK_UNIT_UPDATED'
  | 'INVENTORY_STOCK_UNIT_DELETED'
  | 'INVENTORY_TRANSFER_DISPATCHED'
  | 'INVENTORY_TRANSFER_RECEIVED'
  | 'INVENTORY_COUNT_SUBMITTED'
  | 'INVENTORY_COUNT_APPROVED';

/** Inventory event types that have a workflow catalog entry (payload must come from a registered builder). */
export type InventoryCatalogEventType = Extract<InventoryEventType, WorkflowCatalogEventType>;
/** Inventory event types with no workflow catalog entry (stock-unit search events). */
export type InventoryNonCatalogEventType = Exclude<InventoryEventType, WorkflowCatalogEventType>;

// LEVERAGE: pattern catalog-or-plain-publish — domain publishers keep re-splitting catalogued vs non-catalogued event types by overload; a shared "publishRaw" layer in event-bus would absorb this.
export async function publishInventoryEvent<T extends InventoryCatalogEventType>(
  eventType: T,
  payload: BuiltWorkflowPayload<T>,
): Promise<void>;
export async function publishInventoryEvent(
  eventType: InventoryNonCatalogEventType,
  payload: InventoryEventPayload,
): Promise<void>;
export async function publishInventoryEvent(
  eventType: InventoryEventType,
  payload: InventoryEventPayload,
): Promise<void> {
  try {
    const publishers = await import('@alga-psa/event-bus/publishers');
    // Payloads are snake_case and already complete (builder stamps tenant/timestamp): raw path.
    // The static overloads guarantee catalogued payloads came from a builder; the revive seam
    // re-checks the schema and re-applies the brand at this string-typed boundary.
    const revived = publishers.reviveStoredWorkflowPayload(eventType, payload as Record<string, unknown>);
    if (revived) {
      await publishers.publishBuiltWorkflowPayload(revived);
    } else {
      await publishers.publishNonCatalogEventByName({ eventType, payload: payload as Record<string, unknown> });
    }
  } catch (error) {
    console.error(`[InventoryEvents] Failed to publish ${eventType}:`, error);
  }
}

export function timestampPayload<T extends object>(payload: T = {} as T): T & { timestamp: string } {
  return { ...payload, timestamp: new Date().toISOString() };
}
