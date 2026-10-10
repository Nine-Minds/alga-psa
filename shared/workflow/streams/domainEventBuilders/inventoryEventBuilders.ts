/**
 * Builders for the catalogued inventory lifecycle events (sales orders, purchase orders, stock
 * transfers, cycle counts). These payloads are snake_case (`tenant`, `so_id`, `user_id`) because that
 * is what the registered inventory schemas and the search/notification subscribers read; they are
 * published through the raw event-bus path, so the builder also stamps `timestamp`.
 */

function requireNonEmpty(value: unknown, field: string): void {
  if (value === undefined || value === null || value === '') throw new Error(`${field} is required`);
}

function base(params: { tenant: string; userId?: string; changedFields?: string[]; timestamp?: string }) {
  requireNonEmpty(params.tenant, 'tenant');
  return {
    tenant: params.tenant,
    ...(params.userId ? { user_id: params.userId } : {}),
    ...(params.changedFields ? { changed_fields: params.changedFields } : {}),
    timestamp: params.timestamp ?? new Date().toISOString(),
  };
}

export function buildInventorySalesOrderPayload(params: {
  tenant: string;
  soId: string;
  userId?: string;
  changedFields?: string[];
  timestamp?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.soId, 'soId');
  return { ...base(params), so_id: params.soId };
}

export function buildInventoryPurchaseOrderPayload(params: {
  tenant: string;
  poId: string;
  userId?: string;
  changedFields?: string[];
  timestamp?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.poId, 'poId');
  return { ...base(params), po_id: params.poId };
}

/** Shared by INVENTORY_TRANSFER_DISPATCHED and INVENTORY_TRANSFER_RECEIVED. */
export function buildInventoryTransferPayload(params: {
  tenant: string;
  transferId: string;
  fromLocationId: string;
  toLocationId: string;
  lineCount: number;
  userId?: string;
  timestamp?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.transferId, 'transferId');
  requireNonEmpty(params.fromLocationId, 'fromLocationId');
  requireNonEmpty(params.toLocationId, 'toLocationId');
  return {
    ...base(params),
    transfer_id: params.transferId,
    from_location_id: params.fromLocationId,
    to_location_id: params.toLocationId,
    line_count: params.lineCount,
  };
}

export interface InventoryCountFacts {
  line_count: number;
  counted_line_count: number;
  variance_line_count: number;
  variance_quantity: number;
}

export function buildInventoryCountSubmittedPayload(params: {
  tenant: string;
  sessionId: string;
  locationId: string;
  facts: InventoryCountFacts;
  userId?: string;
  timestamp?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.sessionId, 'sessionId');
  requireNonEmpty(params.locationId, 'locationId');
  return {
    ...base(params),
    session_id: params.sessionId,
    location_id: params.locationId,
    ...params.facts,
  };
}

export function buildInventoryCountApprovedPayload(params: {
  tenant: string;
  sessionId: string;
  locationId: string;
  facts: InventoryCountFacts;
  adjustmentLineCount: number;
  staleLineCount: number;
  uncountedLineCount: number;
  userId?: string;
  timestamp?: string;
}): Record<string, unknown> {
  return {
    ...buildInventoryCountSubmittedPayload(params),
    adjustment_line_count: params.adjustmentLineCount,
    stale_line_count: params.staleLineCount,
    uncounted_line_count: params.uncountedLineCount,
  };
}
