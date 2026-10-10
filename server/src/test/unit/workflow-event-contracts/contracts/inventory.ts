import {
  buildInventoryCountApprovedPayload,
  buildInventoryCountSubmittedPayload,
  buildInventoryPurchaseOrderPayload,
  buildInventorySalesOrderPayload,
  buildInventoryTransferPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW } from '../fixtures';

/**
 * Inventory lifecycle events. Emitters publish through publishInventoryEvent (raw publishEvent,
 * snake_case payloads that the registered inventory schemas expect), so every case uses
 * publishPath 'rawPublishEvent'. The sites previously hand-built `timestampPayload({...})` literals.
 * INVENTORY_STOCK_LOW / PO_RECEIVED / SO_FULFILLED / RMA_CREATED stay schemaNotRegistered in
 * emitterContracts.ts (their catalog refs have no worker schema).
 */

const SO = 'packages/inventory/src/actions/salesOrderActions.ts';
const PO = 'packages/inventory/src/actions/purchaseOrderActions.ts';
const DROP = 'packages/inventory/src/actions/dropShipActions.ts';
const FULFIL = 'packages/inventory/src/actions/fulfillmentActions.ts';
const SERVICE = 'server/src/lib/api/services/InventoryService.ts';
const TRANSFER = 'packages/inventory/src/actions/transferActions.ts';
const COUNT = 'packages/inventory/src/actions/cycleCountActions.ts';

type InventoryEventType =
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

export const inventoryContracts = {
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
