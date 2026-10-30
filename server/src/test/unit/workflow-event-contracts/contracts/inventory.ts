import {
  buildInventoryCountApprovedPayload,
  buildInventoryCountSubmittedPayload,
  buildInventoryPoReceivedPayload,
  buildInventoryPurchaseOrderPayload,
  buildInventoryRmaCreatedPayload,
  buildInventoryRmaUpdatedPayload,
  buildInventorySalesOrderPayload,
  buildInventorySoFulfilledPayload,
  buildInventoryStockLowPayload,
  buildInventoryTransferPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW } from '../fixtures';

/**
 * Inventory lifecycle events. Emitters publish through publishInventoryEvent (raw publishEvent,
 * snake_case payloads that the registered inventory schemas expect), so every case uses
 * publishPath 'rawPublishEvent'. The sites previously hand-built `timestampPayload({...})` literals.
 * STOCK_LOW / PO_RECEIVED / SO_FULFILLED / RMA_CREATED are built after commit by
 * collect-style and core-extraction helpers and published through the same path.
 */

const SO = 'packages/inventory/src/actions/salesOrderActions.ts';
const PO = 'packages/inventory/src/actions/purchaseOrderActions.ts';
const DROP = 'packages/inventory/src/actions/dropShipActions.ts';
const FULFIL = 'packages/inventory/src/actions/fulfillmentActions.ts';
const SERVICE = 'server/src/lib/api/services/InventoryService.ts';
const TRANSFER = 'packages/inventory/src/actions/transferActions.ts';
const COUNT = 'packages/inventory/src/actions/cycleCountActions.ts';

type InventoryEventType =
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
  | 'INVENTORY_TRANSFER_DISPATCHED'
  | 'INVENTORY_TRANSFER_RECEIVED'
  | 'INVENTORY_COUNT_SUBMITTED'
  | 'INVENTORY_COUNT_APPROVED';

const raw = { publishPath: 'rawPublishEvent' as const };
const tenant = IDS.tenant;
const userId = IDS.user;
const counted = { line_count: 12, counted_line_count: 11, variance_line_count: 2, variance_quantity: -3 };

const stockLow = (onHand: number) =>
  buildInventoryStockLowPayload({
    tenant,
    serviceId: IDS.service,
    serviceName: 'Managed firewall appliance',
    sku: 'FW-100',
    locationId: IDS.locationMain,
    locationName: 'Main warehouse',
    onHand,
    reorderPoint: 5,
  });
const soFulfilled = (dropShip: boolean) =>
  buildInventorySoFulfilledPayload({
    tenant,
    soId: IDS.salesOrder,
    soNumber: 'SO-0042',
    clientId: IDS.client,
    fulfilledLineCount: 2,
    dropShip,
  });
const rma = (overrides: Partial<Parameters<typeof buildInventoryRmaCreatedPayload>[0]> = {}) =>
  buildInventoryRmaCreatedPayload({
    tenant,
    rmaId: IDS.rma,
    rmaReference: 'RMA-0007',
    clientId: IDS.client,
    serviceId: IDS.service,
    serialNumber: 'SN-12345',
    ...overrides,
  });

const rmaUpdated = (overrides: Partial<Parameters<typeof buildInventoryRmaUpdatedPayload>[0]> = {}) =>
  buildInventoryRmaUpdatedPayload({
    tenant,
    rmaId: IDS.rma,
    rmaNumber: 'RMA-00007',
    status: 'sent_to_vendor',
    previousStatus: 'returned',
    rmaType: 'standard',
    assetId: IDS.asset,
    ticketId: IDS.ticket,
    clientId: IDS.client,
    warrantyOutcome: 'covered',
    changedFields: ['status', 'outbound_carrier', 'outbound_tracking_number'],
    userId: IDS.user,
    timestamp: NOW,
    ...overrides,
  });

export const inventoryContracts = {
  INVENTORY_STOCK_LOW: {
    status: 'covered',
    cases: [
      { site: `${FULFIL}#fulfillSalesOrderLine`, ...raw, build: () => stockLow(4) },
      { site: `${COUNT}#approveCountSession`, ...raw, build: () => stockLow(0) },
      { site: 'packages/inventory/src/actions/stockLedgerActions.ts#adjustStock', ...raw, build: () => stockLow(5) },
      { site: 'packages/inventory/src/lib/materials.ts#addMaterial', ...raw, build: () => stockLow(2) },
      {
        // item with no SKU
        site: 'packages/inventory/src/lib/stockLowSignal.ts#collectStockLowSignalAfterConsume',
        ...raw,
        build: () =>
          buildInventoryStockLowPayload({
            tenant,
            serviceId: IDS.service,
            serviceName: 'Patch cable',
            sku: null,
            locationId: IDS.locationVan,
            locationName: 'Service van',
            onHand: 1,
            reorderPoint: 3,
          }),
      },
    ],
  },
  INVENTORY_PO_RECEIVED: {
    status: 'covered',
    cases: [
      {
        site: `${PO}#receivePoLine`,
        ...raw,
        build: () =>
          buildInventoryPoReceivedPayload({
            tenant,
            poId: IDS.purchaseOrder,
            poNumber: 'PO-0100',
            vendorId: IDS.vendor,
            vendorName: 'Contoso Distribution',
            receivedLineCount: 3,
          }),
      },
      {
        // vendor was deleted / not recorded
        site: `${SERVICE}#InventoryService.receivePurchaseOrderLine`,
        ...raw,
        build: () =>
          buildInventoryPoReceivedPayload({
            tenant,
            poId: IDS.purchaseOrder,
            poNumber: 'PO-0100',
            vendorId: null,
            vendorName: null,
            receivedLineCount: 1,
          }),
      },
    ],
  },
  INVENTORY_SO_FULFILLED: {
    status: 'covered',
    cases: [
      { site: `${FULFIL}#fulfillSalesOrderLine`, ...raw, build: () => soFulfilled(false) },
      { site: `${DROP}#confirmDropShipShipment`, ...raw, build: () => soFulfilled(true) },
    ],
  },
  INVENTORY_RMA_CREATED: {
    status: 'covered',
    cases: [
      { site: 'packages/inventory/src/actions/rmaActions.ts#openRma', ...raw, build: () => rma() },
      {
        site: 'packages/inventory/src/actions/rmaActions.ts#openAdvanceRma',
        ...raw,
        build: () => rma({ rmaReference: null, serialNumber: null, serviceId: null }),
      },
    ],
  },
  INVENTORY_RMA_UPDATED: {
    status: 'covered',
    cases: [
      { site: 'packages/inventory/src/lib/rma/publishRmaUpdated.ts#publishRmaUpdated', ...raw, build: () => rmaUpdated() },
      {
        // closed without a decision owner or ticket
        site: 'packages/inventory/src/lib/rma/publishRmaUpdated.ts#publishRmaUpdated',
        ...raw,
        build: () => rmaUpdated({ status: 'closed', previousStatus: 'warranty_review', warrantyOutcome: 'not_covered', ticketId: null, userId: undefined }),
      },
    ],
  },
  INVENTORY_SALES_ORDER_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${SO}#createSalesOrder`,
        ...raw,
        build: () => buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, timestamp: NOW }),
      },
    ],
  },
  INVENTORY_SALES_ORDER_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${SO}#updateSoLine`,
        ...raw,
        build: () =>
          buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, changedFields: ['quantity', 'unit_price'], timestamp: NOW }),
      },
      {
        site: `${SO}#addSoLine`,
        ...raw,
        build: () => buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, changedFields: ['lines'], timestamp: NOW }),
      },
      {
        site: `${SO}#removeSoLine`,
        ...raw,
        build: () => buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, changedFields: ['lines'], timestamp: NOW }),
      },
      {
        site: `${SO}#releaseSalesOrderAllocation`,
        ...raw,
        build: () => buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, changedFields: ['allocation'], timestamp: NOW }),
      },
      {
        site: `${SO}#reopenSalesOrder`,
        ...raw,
        build: () =>
          buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, changedFields: ['status', 'allocation'], timestamp: NOW }),
      },
      {
        site: `${SO}#cancelSalesOrder`,
        ...raw,
        build: () =>
          buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, changedFields: ['status', 'allocation'], timestamp: NOW }),
      },
      {
        site: `${SO}#confirmSalesOrder`,
        ...raw,
        build: () =>
          buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, changedFields: ['status', 'allocation'], timestamp: NOW }),
      },
      {
        site: `${DROP}#confirmDropShipShipment`,
        ...raw,
        build: () =>
          buildInventorySalesOrderPayload({
            tenant,
            soId: IDS.salesOrder,
            userId,
            changedFields: ['status', 'quantity_fulfilled'],
            timestamp: NOW,
          }),
      },
      {
        site: `${FULFIL}#fulfillSalesOrderLine`,
        ...raw,
        build: () =>
          buildInventorySalesOrderPayload({
            tenant,
            soId: IDS.salesOrder,
            userId,
            changedFields: ['status', 'quantity_fulfilled'],
            timestamp: NOW,
          }),
      },
    ],
  },
  INVENTORY_SALES_ORDER_DELETED: {
    status: 'covered',
    cases: [
      {
        site: `${SO}#deleteSalesOrder`,
        ...raw,
        build: () => buildInventorySalesOrderPayload({ tenant, soId: IDS.salesOrder, userId, timestamp: NOW }),
      },
    ],
  },
  INVENTORY_PURCHASE_ORDER_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${SO}#suggestPoFromBackorder`,
        ...raw,
        build: () => buildInventoryPurchaseOrderPayload({ tenant, poId: IDS.purchaseOrder, userId, timestamp: NOW }),
      },
      {
        site: `${DROP}#createDropShipForSoLine`,
        ...raw,
        build: () => buildInventoryPurchaseOrderPayload({ tenant, poId: IDS.purchaseOrder, userId, timestamp: NOW }),
      },
    ],
  },
  INVENTORY_PURCHASE_ORDER_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${PO}#updatePoLine`,
        ...raw,
        build: () =>
          buildInventoryPurchaseOrderPayload({ tenant, poId: IDS.purchaseOrder, userId, changedFields: ['quantity_ordered', 'unit_cost'], timestamp: NOW }),
      },
      {
        site: `${PO}#addPoLine`,
        ...raw,
        build: () => buildInventoryPurchaseOrderPayload({ tenant, poId: IDS.purchaseOrder, userId, changedFields: ['lines'], timestamp: NOW }),
      },
      {
        site: `${PO}#removePoLine`,
        ...raw,
        build: () => buildInventoryPurchaseOrderPayload({ tenant, poId: IDS.purchaseOrder, userId, changedFields: ['lines'], timestamp: NOW }),
      },
      {
        site: `${PO}#submitPurchaseOrder`,
        ...raw,
        build: () => buildInventoryPurchaseOrderPayload({ tenant, poId: IDS.purchaseOrder, userId, changedFields: ['status'], timestamp: NOW }),
      },
      {
        site: `${PO}#cancelPurchaseOrder`,
        ...raw,
        build: () => buildInventoryPurchaseOrderPayload({ tenant, poId: IDS.purchaseOrder, userId, changedFields: ['status'], timestamp: NOW }),
      },
      {
        site: `${PO}#receivePoLine`,
        ...raw,
        build: () =>
          buildInventoryPurchaseOrderPayload({
            tenant,
            poId: IDS.purchaseOrder,
            userId,
            changedFields: ['status', 'quantity_received'],
            timestamp: NOW,
          }),
      },
      {
        site: `${SERVICE}#InventoryService.receivePurchaseOrderLine`,
        ...raw,
        build: () =>
          buildInventoryPurchaseOrderPayload({
            tenant,
            poId: IDS.purchaseOrder,
            userId,
            changedFields: ['status', 'quantity_received'],
            timestamp: NOW,
          }),
      },
    ],
  },
  INVENTORY_PURCHASE_ORDER_DELETED: {
    status: 'covered',
    cases: [
      {
        site: `${PO}#deletePurchaseOrder`,
        ...raw,
        build: () => buildInventoryPurchaseOrderPayload({ tenant, poId: IDS.purchaseOrder, userId, timestamp: NOW }),
      },
    ],
  },
  INVENTORY_TRANSFER_DISPATCHED: {
    status: 'covered',
    cases: [
      {
        site: `${TRANSFER}#dispatchTransfer`,
        ...raw,
        build: () =>
          buildInventoryTransferPayload({
            tenant,
            transferId: IDS.transfer,
            fromLocationId: IDS.locationMain,
            toLocationId: IDS.locationVan,
            lineCount: 3,
            userId,
            timestamp: NOW,
          }),
      },
    ],
  },
  INVENTORY_TRANSFER_RECEIVED: {
    status: 'covered',
    cases: [
      {
        site: `${TRANSFER}#receiveTransfer`,
        ...raw,
        build: () =>
          buildInventoryTransferPayload({
            tenant,
            transferId: IDS.transfer,
            fromLocationId: IDS.locationMain,
            toLocationId: IDS.locationVan,
            lineCount: 3,
            userId,
            timestamp: NOW,
          }),
      },
    ],
  },
  INVENTORY_COUNT_SUBMITTED: {
    status: 'covered',
    cases: [
      {
        site: `${COUNT}#submitCountForReview`,
        ...raw,
        build: () =>
          buildInventoryCountSubmittedPayload({
            tenant,
            sessionId: IDS.countSession,
            locationId: IDS.locationMain,
            facts: counted,
            userId,
            timestamp: NOW,
          }),
      },
    ],
  },
  INVENTORY_COUNT_APPROVED: {
    status: 'covered',
    cases: [
      {
        site: `${COUNT}#approveCountSession`,
        ...raw,
        build: () =>
          buildInventoryCountApprovedPayload({
            tenant,
            sessionId: IDS.countSession,
            locationId: IDS.locationMain,
            facts: counted,
            adjustmentLineCount: 2,
            staleLineCount: 0,
            uncountedLineCount: 1,
            userId,
            timestamp: NOW,
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, InventoryEventType>;
