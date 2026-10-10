import type { EmitterContracts } from './registryTypes';
import { pendingMigration, schemaNotRegistered } from './registryTypes';
import { ticketContracts } from './contracts/tickets';
import { projectContracts } from './contracts/projects';
import { schedulingContracts } from './contracts/scheduling';
import { billingContracts } from './contracts/billing';
import { crmContracts } from './contracts/crm';
import { documentContracts } from './contracts/documents';
import { surveyContracts } from './contracts/surveys';
import { emailContracts } from './contracts/email';

/**
 * Emitter contract registry. One entry per workflow-catalogued event type.
 *
 * The mapped type makes this exhaustive at compile time: adding an event to
 * WORKFLOW_EVENT_CATALOG without an entry here fails `typecheck`.
 *
 * - `covered`: every case calls the real exported builder the product emitter uses, and the
 *   resulting payload must pass the schema the workflow worker uses.
 * - `known-drift`: the emitter fails the contract today (or its builder is not extracted yet).
 *   Tracked against a ticket; runs under it.fails.
 * - `no-product-emitter`: the catalog advertises the trigger but nothing fires it.
 */
export const emitterContracts: EmitterContracts = {
  // ---- tickets ----
  ...ticketContracts,
  // ---- projects ----
  ...projectContracts,
  // ---- scheduling / dispatch ----
  ...schedulingContracts,
  // ---- billing ----
  ...billingContracts,
  // ---- crm / tags ----
  ...crmContracts,
  // ---- documents / storage / media ----
  ...documentContracts,
  ...surveyContracts,
  ...emailContracts,
  // ---- scheduling ----
  // ---- billing ----
  PROJECT_MILESTONE_READY: schemaNotRegistered('PROJECT_MILESTONE_READY', 'payload.ProjectMilestoneReady.v1'),
  PROJECT_BUDGET_THRESHOLD_REACHED: schemaNotRegistered('PROJECT_BUDGET_THRESHOLD_REACHED', 'payload.ProjectBudgetThresholdReached.v1'),
  PROJECT_BUDGET_EXCEEDED: schemaNotRegistered('PROJECT_BUDGET_EXCEEDED', 'payload.ProjectBudgetExceeded.v1'),
  PROJECT_BILLING_CONFIG_CREATED: schemaNotRegistered('PROJECT_BILLING_CONFIG_CREATED', 'payload.ProjectBillingConfigCreated.v1'),
  PROJECT_BILLING_CONFIG_UPDATED: schemaNotRegistered('PROJECT_BILLING_CONFIG_UPDATED', 'payload.ProjectBillingConfigUpdated.v1'),
  PROJECT_BILLING_CONFIG_DELETED: schemaNotRegistered('PROJECT_BILLING_CONFIG_DELETED', 'payload.ProjectBillingConfigDeleted.v1'),
  PROJECT_BILLING_SCHEDULE_ENTRY_CREATED: schemaNotRegistered('PROJECT_BILLING_SCHEDULE_ENTRY_CREATED', 'payload.ProjectBillingScheduleEntryCreated.v1'),
  PROJECT_BILLING_SCHEDULE_ENTRY_UPDATED: schemaNotRegistered('PROJECT_BILLING_SCHEDULE_ENTRY_UPDATED', 'payload.ProjectBillingScheduleEntryUpdated.v1'),
  PROJECT_BILLING_SCHEDULE_STATUS_CHANGED: schemaNotRegistered('PROJECT_BILLING_SCHEDULE_STATUS_CHANGED', 'payload.ProjectBillingScheduleStatusChanged.v1'),
  PROJECT_BILLING_SCHEDULE_ENTRY_DELETED: schemaNotRegistered('PROJECT_BILLING_SCHEDULE_ENTRY_DELETED', 'payload.ProjectBillingScheduleEntryDeleted.v1'),
  PROJECT_BILLING_PAYMENT_STATUS_CHANGED: schemaNotRegistered('PROJECT_BILLING_PAYMENT_STATUS_CHANGED', 'payload.ProjectBillingPaymentStatusChanged.v1'),
  // ---- crm ----
  OPPORTUNITY_CREATED: schemaNotRegistered('OPPORTUNITY_CREATED', 'payload.OpportunityCreated.v1'),
  OPPORTUNITY_STAGE_CHANGED: schemaNotRegistered('OPPORTUNITY_STAGE_CHANGED', 'payload.OpportunityStageChanged.v1'),
  OPPORTUNITY_STATUS_CHANGED: schemaNotRegistered('OPPORTUNITY_STATUS_CHANGED', 'payload.OpportunityStatusChanged.v1'),
  OPPORTUNITY_STALLED: schemaNotRegistered('OPPORTUNITY_STALLED', 'payload.OpportunityStalled.v1'),
  OPPORTUNITY_ESCALATED: schemaNotRegistered('OPPORTUNITY_ESCALATED', 'payload.OpportunityEscalated.v1'),
  OPPORTUNITY_NEXT_ACTION_OVERDUE: schemaNotRegistered('OPPORTUNITY_NEXT_ACTION_OVERDUE', 'payload.OpportunityNextActionOverdue.v1'),
  OPPORTUNITY_SUGGESTION_CREATED: schemaNotRegistered('OPPORTUNITY_SUGGESTION_CREATED', 'payload.OpportunitySuggestionCreated.v1'),
  // ---- documents ----
  // ---- comms ----
  ASSET_ASSIGNED: pendingMigration('ASSET_ASSIGNED', 'comms'),
  ASSET_CREATED: pendingMigration('ASSET_CREATED', 'comms'),
  ASSET_UNASSIGNED: pendingMigration('ASSET_UNASSIGNED', 'comms'),
  ASSET_UPDATED: pendingMigration('ASSET_UPDATED', 'comms'),
  ASSET_WARRANTY_EXPIRING: pendingMigration('ASSET_WARRANTY_EXPIRING', 'comms'),
  EXTERNAL_MAPPING_CHANGED: pendingMigration('EXTERNAL_MAPPING_CHANGED', 'comms'),
  INTEGRATION_CONNECTED: pendingMigration('INTEGRATION_CONNECTED', 'comms'),
  INTEGRATION_DISCONNECTED: pendingMigration('INTEGRATION_DISCONNECTED', 'comms'),
  INTEGRATION_SYNC_COMPLETED: pendingMigration('INTEGRATION_SYNC_COMPLETED', 'comms'),
  INTEGRATION_SYNC_FAILED: pendingMigration('INTEGRATION_SYNC_FAILED', 'comms'),
  INTEGRATION_SYNC_STARTED: pendingMigration('INTEGRATION_SYNC_STARTED', 'comms'),
  INTEGRATION_TOKEN_EXPIRING: pendingMigration('INTEGRATION_TOKEN_EXPIRING', 'comms'),
  INTEGRATION_TOKEN_REFRESH_FAILED: pendingMigration('INTEGRATION_TOKEN_REFRESH_FAILED', 'comms'),
  INTEGRATION_WEBHOOK_RECEIVED: pendingMigration('INTEGRATION_WEBHOOK_RECEIVED', 'comms'),
  NOTIFICATION_DELIVERED: pendingMigration('NOTIFICATION_DELIVERED', 'comms'),
  NOTIFICATION_FAILED: pendingMigration('NOTIFICATION_FAILED', 'comms'),
  NOTIFICATION_READ: pendingMigration('NOTIFICATION_READ', 'comms'),
  NOTIFICATION_SENT: pendingMigration('NOTIFICATION_SENT', 'comms'),
  // ---- remaining ----
  INVENTORY_STOCK_LOW: schemaNotRegistered('INVENTORY_STOCK_LOW', 'payload.InventoryStockLow.v1'),
  INVENTORY_PO_RECEIVED: schemaNotRegistered('INVENTORY_PO_RECEIVED', 'payload.InventoryPoReceived.v1'),
  INVENTORY_SO_FULFILLED: schemaNotRegistered('INVENTORY_SO_FULFILLED', 'payload.InventorySoFulfilled.v1'),
  INVENTORY_RMA_CREATED: schemaNotRegistered('INVENTORY_RMA_CREATED', 'payload.InventoryRmaCreated.v1'),
  INVENTORY_SALES_ORDER_CREATED: pendingMigration('INVENTORY_SALES_ORDER_CREATED', 'remaining'),
  INVENTORY_SALES_ORDER_UPDATED: pendingMigration('INVENTORY_SALES_ORDER_UPDATED', 'remaining'),
  INVENTORY_SALES_ORDER_DELETED: pendingMigration('INVENTORY_SALES_ORDER_DELETED', 'remaining'),
  INVENTORY_PURCHASE_ORDER_CREATED: pendingMigration('INVENTORY_PURCHASE_ORDER_CREATED', 'remaining'),
  INVENTORY_PURCHASE_ORDER_UPDATED: pendingMigration('INVENTORY_PURCHASE_ORDER_UPDATED', 'remaining'),
  INVENTORY_PURCHASE_ORDER_DELETED: pendingMigration('INVENTORY_PURCHASE_ORDER_DELETED', 'remaining'),
  INVENTORY_TRANSFER_DISPATCHED: pendingMigration('INVENTORY_TRANSFER_DISPATCHED', 'remaining'),
  INVENTORY_TRANSFER_RECEIVED: pendingMigration('INVENTORY_TRANSFER_RECEIVED', 'remaining'),
  INVENTORY_COUNT_SUBMITTED: pendingMigration('INVENTORY_COUNT_SUBMITTED', 'remaining'),
  INVENTORY_COUNT_APPROVED: pendingMigration('INVENTORY_COUNT_APPROVED', 'remaining'),
};
