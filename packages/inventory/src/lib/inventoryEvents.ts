export type InventoryEventPayload = object;

export type InventoryEventType =
  | 'INVENTORY_STOCK_LOW'
  | 'INVENTORY_PO_RECEIVED'
  | 'INVENTORY_SO_FULFILLED'
  | 'INVENTORY_RMA_CREATED'
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

export async function publishInventoryEvent(
  eventType: InventoryEventType,
  payload: InventoryEventPayload,
): Promise<void> {
  try {
    const { publishEvent } = await import('@alga-psa/event-bus/publishers');
    await publishEvent({ eventType, payload } as never);
  } catch (error) {
    console.error(`[InventoryEvents] Failed to publish ${eventType}:`, error);
  }
}

export async function publishInventoryEvents(
  events: Array<{ eventType: InventoryEventType; payload: InventoryEventPayload }>,
): Promise<void> {
  for (const event of events) {
    await publishInventoryEvent(event.eventType, event.payload);
  }
}

export function timestampPayload<T extends object>(payload: T = {} as T): T & { timestamp: string } {
  return { ...payload, timestamp: new Date().toISOString() };
}
