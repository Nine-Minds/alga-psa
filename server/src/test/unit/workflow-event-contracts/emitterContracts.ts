import type { EmitterContracts } from './registryTypes';
import { schemaNotRegistered } from './registryTypes';
import { ticketContracts } from './contracts/tickets';
import { projectContracts } from './contracts/projects';
import { schedulingContracts } from './contracts/scheduling';
import { billingContracts } from './contracts/billing';
import { crmContracts } from './contracts/crm';
import { documentContracts } from './contracts/documents';
import { surveyContracts } from './contracts/surveys';
import { emailContracts } from './contracts/email';
import { notificationContracts } from './contracts/notifications';
import { integrationContracts } from './contracts/integrations';
import { inventoryContracts } from './contracts/inventory';
import { assetContracts } from './contracts/assets';

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
  ...notificationContracts,
  ...integrationContracts,
  ...assetContracts,
  ...inventoryContracts,
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
  // ---- remaining ----
  INVENTORY_STOCK_LOW: schemaNotRegistered('INVENTORY_STOCK_LOW', 'payload.InventoryStockLow.v1'),
  INVENTORY_PO_RECEIVED: schemaNotRegistered('INVENTORY_PO_RECEIVED', 'payload.InventoryPoReceived.v1'),
  INVENTORY_SO_FULFILLED: schemaNotRegistered('INVENTORY_SO_FULFILLED', 'payload.InventorySoFulfilled.v1'),
  INVENTORY_RMA_CREATED: schemaNotRegistered('INVENTORY_RMA_CREATED', 'payload.InventoryRmaCreated.v1'),
};
