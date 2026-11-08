import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

/**
 * Builders for the catalogued inventory lifecycle events (sales orders, purchase orders, stock
 * transfers, cycle counts). These payloads are snake_case (`tenant`, `so_id`, `user_id`) because that
 * is what the registered inventory schemas and the search/notification subscribers read; they are
 * published through the raw event-bus path, so the builder also stamps `timestamp`.
 */

type SalesOrderEvents = 'INVENTORY_SALES_ORDER_CREATED' | 'INVENTORY_SALES_ORDER_UPDATED' | 'INVENTORY_SALES_ORDER_DELETED';
type PurchaseOrderEvents = 'INVENTORY_PURCHASE_ORDER_CREATED' | 'INVENTORY_PURCHASE_ORDER_UPDATED' | 'INVENTORY_PURCHASE_ORDER_DELETED';
type TransferEvents = 'INVENTORY_TRANSFER_DISPATCHED' | 'INVENTORY_TRANSFER_RECEIVED';

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
}): Record<string, unknown> & BuiltWorkflowPayload<SalesOrderEvents> {
  requireNonEmpty(params.soId, 'soId');
  return builtWorkflowPayload<SalesOrderEvents, Record<string, unknown>>('INVENTORY_SALES_ORDER_CREATED', {
    ...base(params),
    so_id: params.soId,
  });
}

export function buildInventoryPurchaseOrderPayload(params: {
  tenant: string;
  poId: string;
  userId?: string;
  changedFields?: string[];
  timestamp?: string;
}): Record<string, unknown> & BuiltWorkflowPayload<PurchaseOrderEvents> {
  requireNonEmpty(params.poId, 'poId');
  return builtWorkflowPayload<PurchaseOrderEvents, Record<string, unknown>>('INVENTORY_PURCHASE_ORDER_CREATED', {
    ...base(params),
    po_id: params.poId,
  });
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
}): Record<string, unknown> & BuiltWorkflowPayload<TransferEvents> {
  requireNonEmpty(params.transferId, 'transferId');
  requireNonEmpty(params.fromLocationId, 'fromLocationId');
  requireNonEmpty(params.toLocationId, 'toLocationId');
  return builtWorkflowPayload<TransferEvents, Record<string, unknown>>('INVENTORY_TRANSFER_DISPATCHED', {
    ...base(params),
    transfer_id: params.transferId,
    from_location_id: params.fromLocationId,
    to_location_id: params.toLocationId,
    line_count: params.lineCount,
  });
}

export interface InventoryCountFacts {
  line_count: number;
  counted_line_count: number;
  variance_line_count: number;
  variance_quantity: number;
}

function countSubmittedFields(params: {
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

export function buildInventoryCountSubmittedPayload(params: {
  tenant: string;
  sessionId: string;
  locationId: string;
  facts: InventoryCountFacts;
  userId?: string;
  timestamp?: string;
}): Record<string, unknown> & BuiltWorkflowPayload<'INVENTORY_COUNT_SUBMITTED'> {
  return builtWorkflowPayload('INVENTORY_COUNT_SUBMITTED', countSubmittedFields(params));
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
}): Record<string, unknown> & BuiltWorkflowPayload<'INVENTORY_COUNT_APPROVED'> {
  return builtWorkflowPayload('INVENTORY_COUNT_APPROVED', {
    ...countSubmittedFields(params),
    adjustment_line_count: params.adjustmentLineCount,
    stale_line_count: params.staleLineCount,
    uncounted_line_count: params.uncountedLineCount,
  });
}

/** INVENTORY_STOCK_LOW: a downward stock change crossed the reorder point (published after commit). */
export function buildInventoryStockLowPayload(params: {
  tenant: string;
  serviceId: string;
  serviceName: string;
  sku: string | null;
  locationId: string;
  locationName: string;
  onHand: number;
  reorderPoint: number;
}) {
  return builtWorkflowPayload('INVENTORY_STOCK_LOW', {
    tenant: params.tenant,
    service_id: params.serviceId,
    service_name: params.serviceName,
    sku: params.sku,
    location_id: params.locationId,
    location_name: params.locationName,
    on_hand: params.onHand,
    reorder_point: params.reorderPoint,
  });
}

/** INVENTORY_PO_RECEIVED (published after commit). */
export function buildInventoryPoReceivedPayload(params: {
  tenant: string;
  poId: string;
  poNumber: string;
  vendorId: string | null;
  vendorName: string | null;
  receivedLineCount: number;
}) {
  return builtWorkflowPayload('INVENTORY_PO_RECEIVED', {
    tenant: params.tenant,
    po_id: params.poId,
    po_number: params.poNumber,
    vendor_id: params.vendorId,
    vendor_name: params.vendorName,
    received_line_count: params.receivedLineCount,
  });
}

/** INVENTORY_SO_FULFILLED (published after commit). */
export function buildInventorySoFulfilledPayload(params: {
  tenant: string;
  soId: string;
  soNumber: string;
  clientId: string | null;
  fulfilledLineCount: number;
  dropShip: boolean;
}) {
  return builtWorkflowPayload('INVENTORY_SO_FULFILLED', {
    tenant: params.tenant,
    so_id: params.soId,
    so_number: params.soNumber,
    client_id: params.clientId,
    fulfilled_line_count: params.fulfilledLineCount,
    drop_ship: params.dropShip,
  });
}

/** INVENTORY_RMA_UPDATED (published after commit; client-asset warranty claims, C5). */
export function buildInventoryRmaUpdatedPayload(params: {
  tenant: string;
  rmaId: string;
  rmaNumber: string;
  status: string;
  previousStatus: string | null;
  rmaType: 'standard' | 'advance_replacement';
  assetId: string | null;
  ticketId: string | null;
  clientId: string | null;
  warrantyOutcome: 'covered' | 'not_covered' | 'unknown' | null;
  changedFields: string[];
  userId?: string;
  timestamp: string;
}) {
  return builtWorkflowPayload('INVENTORY_RMA_UPDATED', {
    tenant: params.tenant,
    rma_id: params.rmaId,
    rma_number: params.rmaNumber,
    status: params.status,
    previous_status: params.previousStatus,
    rma_type: params.rmaType,
    asset_id: params.assetId,
    ticket_id: params.ticketId,
    client_id: params.clientId,
    warranty_outcome: params.warrantyOutcome,
    changed_fields: params.changedFields,
    ...(params.userId ? { user_id: params.userId } : {}),
    timestamp: params.timestamp,
  });
}

/** INVENTORY_RMA_CREATED (published after commit). */
export function buildInventoryRmaCreatedPayload(params: {
  tenant: string;
  rmaId: string;
  rmaReference: string | null;
  clientId: string | null;
  serviceId: string | null;
  serialNumber: string | null;
}) {
  return builtWorkflowPayload('INVENTORY_RMA_CREATED', {
    tenant: params.tenant,
    rma_id: params.rmaId,
    rma_reference: params.rmaReference,
    client_id: params.clientId,
    service_id: params.serviceId,
    serial_number: params.serialNumber,
  });
}
