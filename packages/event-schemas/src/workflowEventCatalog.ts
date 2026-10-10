/**
 * Code-level workflow event catalog: the single reviewed source of truth for
 * "which event types are workflow triggers, and which payload schema does each
 * one validate against".
 *
 * The database remains the writer (tenant databases are seeded by migrations),
 * but the migrations only restate this map. The integration-lane parity test
 * (server/src/test/infrastructure/workflowEventCatalogParity.test.ts) asserts
 * that `system_event_catalog` rows with a non-null `payload_schema_ref` equal
 * this map exactly, so a seed migration and this file cannot drift apart.
 *
 * Refs are written out explicitly (never computed) so the map is greppable and
 * every addition is a reviewed diff. The v2 upsert migration derives its refs by
 * the `payload.<PascalCase>.v1` convention; the explicit values below are the
 * result of that derivation plus the later per-feature seed migrations.
 *
 * Source migrations (server/migrations):
 *   20251228192000_register_ticket_events_schema_refs
 *   20251228190000_add_email_provider_event_schema_refs
 *   20251228191000_update_inbound_email_schema_ref_infer_tenant
 *   20260123150000_upsert_domain_workflow_event_catalog_v2   (bulk of the map)
 *   20260702150000_seed_inventory_event_catalog
 *   20260712105100_seed_opportunity_event_catalog
 *   20260715150000_seed_project_billing_event_catalog
 *   20260716140000_seed_inventory_workflow_events
 *   20260923120000_add_client_anniversary_workflow_event
 *
 * Adding a catalogued event: add the row here, add the seed migration, add the
 * schema to `workflowEventPayloadSchemas`, and add an entry to the emitter
 * contract registry (server/src/test/unit/workflow-event-contracts).
 */
export const WORKFLOW_EVENT_CATALOG = {
  TICKET_CREATED: { schemaRef: 'payload.TicketCreated.v1' },
  TICKET_UPDATED: { schemaRef: 'payload.TicketUpdated.v1' },
  TICKET_CLOSED: { schemaRef: 'payload.TicketClosed.v1' },
  TICKET_RESPONSE_STATE_CHANGED: { schemaRef: 'payload.TicketResponseStateChanged.v1' },
  PROJECT_CREATED: { schemaRef: 'payload.ProjectCreated.v1' },
  INVOICE_GENERATED: { schemaRef: 'payload.InvoiceGenerated.v1' },
  INVOICE_FINALIZED: { schemaRef: 'payload.InvoiceFinalized.v1' },
  INBOUND_EMAIL_RECEIVED: { schemaRef: 'payload.InboundEmailReceived.v1' },
  EMAIL_PROVIDER_CONNECTED: { schemaRef: 'payload.EmailProviderConnected.v1' },
  EMAIL_PROVIDER_DISCONNECTED: { schemaRef: 'payload.EmailProviderDisconnected.v1' },
  APPOINTMENT_ASSIGNED: { schemaRef: 'payload.AppointmentAssigned.v1' },
  APPOINTMENT_CANCELED: { schemaRef: 'payload.AppointmentCanceled.v1' },
  APPOINTMENT_COMPLETED: { schemaRef: 'payload.AppointmentCompleted.v1' },
  APPOINTMENT_CREATED: { schemaRef: 'payload.AppointmentCreated.v1' },
  APPOINTMENT_NO_SHOW: { schemaRef: 'payload.AppointmentNoShow.v1' },
  APPOINTMENT_RESCHEDULED: { schemaRef: 'payload.AppointmentRescheduled.v1' },
  ASSET_ASSIGNED: { schemaRef: 'payload.AssetAssigned.v1' },
  ASSET_CREATED: { schemaRef: 'payload.AssetCreated.v1' },
  ASSET_UNASSIGNED: { schemaRef: 'payload.AssetUnassigned.v1' },
  ASSET_UPDATED: { schemaRef: 'payload.AssetUpdated.v1' },
  ASSET_WARRANTY_EXPIRING: { schemaRef: 'payload.AssetWarrantyExpiring.v1' },
  CAPACITY_THRESHOLD_REACHED: { schemaRef: 'payload.CapacityThresholdReached.v1' },
  CLIENT_ARCHIVED: { schemaRef: 'payload.ClientArchived.v1' },
  CLIENT_CREATED: { schemaRef: 'payload.ClientCreated.v1' },
  CLIENT_MERGED: { schemaRef: 'payload.ClientMerged.v1' },
  CLIENT_OWNER_ASSIGNED: { schemaRef: 'payload.ClientOwnerAssigned.v1' },
  CLIENT_STATUS_CHANGED: { schemaRef: 'payload.ClientStatusChanged.v1' },
  CLIENT_UPDATED: { schemaRef: 'payload.ClientUpdated.v1' },
  CONTACT_ARCHIVED: { schemaRef: 'payload.ContactArchived.v1' },
  CONTACT_CREATED: { schemaRef: 'payload.ContactCreated.v1' },
  CONTACT_MERGED: { schemaRef: 'payload.ContactMerged.v1' },
  CONTACT_PRIMARY_SET: { schemaRef: 'payload.ContactPrimarySet.v1' },
  CONTACT_UPDATED: { schemaRef: 'payload.ContactUpdated.v1' },
  CONTRACT_CREATED: { schemaRef: 'payload.ContractCreated.v1' },
  CONTRACT_RENEWAL_UPCOMING: { schemaRef: 'payload.ContractRenewalUpcoming.v1' },
  CONTRACT_STATUS_CHANGED: { schemaRef: 'payload.ContractStatusChanged.v1' },
  CONTRACT_UPDATED: { schemaRef: 'payload.ContractUpdated.v1' },
  CREDIT_NOTE_APPLIED: { schemaRef: 'payload.CreditNoteApplied.v1' },
  CREDIT_NOTE_CREATED: { schemaRef: 'payload.CreditNoteCreated.v1' },
  CREDIT_NOTE_VOIDED: { schemaRef: 'payload.CreditNoteVoided.v1' },
  CSAT_ALERT_TRIGGERED: { schemaRef: 'payload.CsatAlertTriggered.v1' },
  DOCUMENT_ASSOCIATED: { schemaRef: 'payload.DocumentAssociated.v1' },
  DOCUMENT_DELETED: { schemaRef: 'payload.DocumentDeleted.v1' },
  DOCUMENT_DETACHED: { schemaRef: 'payload.DocumentDetached.v1' },
  DOCUMENT_GENERATED: { schemaRef: 'payload.DocumentGenerated.v1' },
  DOCUMENT_SIGNATURE_EXPIRED: { schemaRef: 'payload.DocumentSignatureExpired.v1' },
  DOCUMENT_SIGNATURE_REQUESTED: { schemaRef: 'payload.DocumentSignatureRequested.v1' },
  DOCUMENT_SIGNED: { schemaRef: 'payload.DocumentSigned.v1' },
  DOCUMENT_UPLOADED: { schemaRef: 'payload.DocumentUploaded.v1' },
  EMAIL_BOUNCED: { schemaRef: 'payload.EmailBounced.v1' },
  EMAIL_COMPLAINT_RECEIVED: { schemaRef: 'payload.EmailComplaintReceived.v1' },
  EMAIL_DELIVERED: { schemaRef: 'payload.EmailDelivered.v1' },
  EMAIL_UNSUBSCRIBED: { schemaRef: 'payload.EmailUnsubscribed.v1' },
  EXTERNAL_MAPPING_CHANGED: { schemaRef: 'payload.ExternalMappingChanged.v1' },
  FILE_UPLOADED: { schemaRef: 'payload.FileUploaded.v1' },
  INBOUND_EMAIL_REPLY_RECEIVED: { schemaRef: 'payload.InboundEmailReplyReceived.v1' },
  INTEGRATION_CONNECTED: { schemaRef: 'payload.IntegrationConnected.v1' },
  INTEGRATION_DISCONNECTED: { schemaRef: 'payload.IntegrationDisconnected.v1' },
  INTEGRATION_SYNC_COMPLETED: { schemaRef: 'payload.IntegrationSyncCompleted.v1' },
  INTEGRATION_SYNC_FAILED: { schemaRef: 'payload.IntegrationSyncFailed.v1' },
  INTEGRATION_SYNC_STARTED: { schemaRef: 'payload.IntegrationSyncStarted.v1' },
  INTEGRATION_TOKEN_EXPIRING: { schemaRef: 'payload.IntegrationTokenExpiring.v1' },
  INTEGRATION_TOKEN_REFRESH_FAILED: { schemaRef: 'payload.IntegrationTokenRefreshFailed.v1' },
  INTEGRATION_WEBHOOK_RECEIVED: { schemaRef: 'payload.IntegrationWebhookReceived.v1' },
  INTERACTION_LOGGED: { schemaRef: 'payload.InteractionLogged.v1' },
  INVOICE_DUE_DATE_CHANGED: { schemaRef: 'payload.InvoiceDueDateChanged.v1' },
  INVOICE_OVERDUE: { schemaRef: 'payload.InvoiceOverdue.v1' },
  INVOICE_SENT: { schemaRef: 'payload.InvoiceSent.v1' },
  INVOICE_STATUS_CHANGED: { schemaRef: 'payload.InvoiceStatusChanged.v1' },
  INVOICE_WRITTEN_OFF: { schemaRef: 'payload.InvoiceWrittenOff.v1' },
  MEDIA_PROCESSING_FAILED: { schemaRef: 'payload.MediaProcessingFailed.v1' },
  MEDIA_PROCESSING_SUCCEEDED: { schemaRef: 'payload.MediaProcessingSucceeded.v1' },
  NOTE_CREATED: { schemaRef: 'payload.NoteCreated.v1' },
  NOTIFICATION_DELIVERED: { schemaRef: 'payload.NotificationDelivered.v1' },
  NOTIFICATION_FAILED: { schemaRef: 'payload.NotificationFailed.v1' },
  NOTIFICATION_READ: { schemaRef: 'payload.NotificationRead.v1' },
  NOTIFICATION_SENT: { schemaRef: 'payload.NotificationSent.v1' },
  OUTBOUND_EMAIL_FAILED: { schemaRef: 'payload.OutboundEmailFailed.v1' },
  OUTBOUND_EMAIL_QUEUED: { schemaRef: 'payload.OutboundEmailQueued.v1' },
  OUTBOUND_EMAIL_SENT: { schemaRef: 'payload.OutboundEmailSent.v1' },
  PAYMENT_APPLIED: { schemaRef: 'payload.PaymentApplied.v1' },
  PAYMENT_FAILED: { schemaRef: 'payload.PaymentFailed.v1' },
  PAYMENT_RECORDED: { schemaRef: 'payload.PaymentRecorded.v1' },
  PAYMENT_REFUNDED: { schemaRef: 'payload.PaymentRefunded.v1' },
  PROJECT_APPROVAL_GRANTED: { schemaRef: 'payload.ProjectApprovalGranted.v1' },
  PROJECT_APPROVAL_REJECTED: { schemaRef: 'payload.ProjectApprovalRejected.v1' },
  PROJECT_APPROVAL_REQUESTED: { schemaRef: 'payload.ProjectApprovalRequested.v1' },
  PROJECT_STATUS_CHANGED: { schemaRef: 'payload.ProjectStatusChanged.v1' },
  PROJECT_TASK_ASSIGNED: { schemaRef: 'payload.ProjectTaskAssigned.v1' },
  PROJECT_TASK_COMPLETED: { schemaRef: 'payload.ProjectTaskCompleted.v1' },
  PROJECT_TASK_CREATED: { schemaRef: 'payload.ProjectTaskCreated.v1' },
  PROJECT_TASK_DEPENDENCY_BLOCKED: { schemaRef: 'payload.ProjectTaskDependencyBlocked.v1' },
  PROJECT_TASK_DEPENDENCY_UNBLOCKED: { schemaRef: 'payload.ProjectTaskDependencyUnblocked.v1' },
  PROJECT_TASK_STATUS_CHANGED: { schemaRef: 'payload.ProjectTaskStatusChanged.v1' },
  PROJECT_UPDATED: { schemaRef: 'payload.ProjectUpdated.v1' },
  RECURRING_BILLING_RUN_COMPLETED: { schemaRef: 'payload.RecurringBillingRunCompleted.v1' },
  RECURRING_BILLING_RUN_FAILED: { schemaRef: 'payload.RecurringBillingRunFailed.v1' },
  RECURRING_BILLING_RUN_STARTED: { schemaRef: 'payload.RecurringBillingRunStarted.v1' },
  SCHEDULE_BLOCK_CREATED: { schemaRef: 'payload.ScheduleBlockCreated.v1' },
  SCHEDULE_BLOCK_DELETED: { schemaRef: 'payload.ScheduleBlockDeleted.v1' },
  SURVEY_EXPIRED: { schemaRef: 'payload.SurveyExpired.v1' },
  SURVEY_REMINDER_SENT: { schemaRef: 'payload.SurveyReminderSent.v1' },
  SURVEY_RESPONSE_RECEIVED: { schemaRef: 'payload.SurveyResponseReceived.v1' },
  SURVEY_SENT: { schemaRef: 'payload.SurveySent.v1' },
  TAG_APPLIED: { schemaRef: 'payload.TagApplied.v1' },
  TAG_DEFINITION_CREATED: { schemaRef: 'payload.TagDefinitionCreated.v1' },
  TAG_DEFINITION_UPDATED: { schemaRef: 'payload.TagDefinitionUpdated.v1' },
  TAG_REMOVED: { schemaRef: 'payload.TagRemoved.v1' },
  TECHNICIAN_ARRIVED: { schemaRef: 'payload.TechnicianArrived.v1' },
  TECHNICIAN_CHECKED_OUT: { schemaRef: 'payload.TechnicianCheckedOut.v1' },
  TECHNICIAN_DISPATCHED: { schemaRef: 'payload.TechnicianDispatched.v1' },
  TECHNICIAN_EN_ROUTE: { schemaRef: 'payload.TechnicianEnRoute.v1' },
  TICKET_APPROVAL_GRANTED: { schemaRef: 'payload.TicketApprovalGranted.v1' },
  TICKET_APPROVAL_REJECTED: { schemaRef: 'payload.TicketApprovalRejected.v1' },
  TICKET_APPROVAL_REQUESTED: { schemaRef: 'payload.TicketApprovalRequested.v1' },
  TICKET_ASSIGNED: { schemaRef: 'payload.TicketAssigned.v1' },
  TICKET_CUSTOMER_REPLIED: { schemaRef: 'payload.TicketCustomerReplied.v1' },
  TICKET_ESCALATED: { schemaRef: 'payload.TicketEscalated.v1' },
  TICKET_INTERNAL_NOTE_ADDED: { schemaRef: 'payload.TicketInternalNoteAdded.v1' },
  TICKET_MERGED: { schemaRef: 'payload.TicketMerged.v1' },
  TICKET_MESSAGE_ADDED: { schemaRef: 'payload.TicketMessageAdded.v1' },
  TICKET_PRIORITY_CHANGED: { schemaRef: 'payload.TicketPriorityChanged.v1' },
  TICKET_QUEUE_CHANGED: { schemaRef: 'payload.TicketQueueChanged.v1' },
  TICKET_REOPENED: { schemaRef: 'payload.TicketReopened.v1' },
  TICKET_SLA_STAGE_BREACHED: { schemaRef: 'payload.TicketSlaStageBreached.v1' },
  TICKET_SLA_STAGE_ENTERED: { schemaRef: 'payload.TicketSlaStageEntered.v1' },
  TICKET_SLA_STAGE_MET: { schemaRef: 'payload.TicketSlaStageMet.v1' },
  TICKET_SPLIT: { schemaRef: 'payload.TicketSplit.v1' },
  TICKET_STATUS_CHANGED: { schemaRef: 'payload.TicketStatusChanged.v1' },
  TICKET_TAGS_CHANGED: { schemaRef: 'payload.TicketTagsChanged.v1' },
  TICKET_TIME_ENTRY_ADDED: { schemaRef: 'payload.TicketTimeEntryAdded.v1' },
  TICKET_UNASSIGNED: { schemaRef: 'payload.TicketUnassigned.v1' },
  INVENTORY_STOCK_LOW: { schemaRef: 'payload.InventoryStockLow.v1' },
  INVENTORY_PO_RECEIVED: { schemaRef: 'payload.InventoryPoReceived.v1' },
  INVENTORY_SO_FULFILLED: { schemaRef: 'payload.InventorySoFulfilled.v1' },
  INVENTORY_RMA_CREATED: { schemaRef: 'payload.InventoryRmaCreated.v1' },
  OPPORTUNITY_CREATED: { schemaRef: 'payload.OpportunityCreated.v1' },
  OPPORTUNITY_STAGE_CHANGED: { schemaRef: 'payload.OpportunityStageChanged.v1' },
  OPPORTUNITY_STATUS_CHANGED: { schemaRef: 'payload.OpportunityStatusChanged.v1' },
  OPPORTUNITY_STALLED: { schemaRef: 'payload.OpportunityStalled.v1' },
  OPPORTUNITY_ESCALATED: { schemaRef: 'payload.OpportunityEscalated.v1' },
  OPPORTUNITY_NEXT_ACTION_OVERDUE: { schemaRef: 'payload.OpportunityNextActionOverdue.v1' },
  OPPORTUNITY_SUGGESTION_CREATED: { schemaRef: 'payload.OpportunitySuggestionCreated.v1' },
  PROJECT_MILESTONE_READY: { schemaRef: 'payload.ProjectMilestoneReady.v1' },
  PROJECT_BUDGET_THRESHOLD_REACHED: { schemaRef: 'payload.ProjectBudgetThresholdReached.v1' },
  PROJECT_BUDGET_EXCEEDED: { schemaRef: 'payload.ProjectBudgetExceeded.v1' },
  PROJECT_BILLING_CONFIG_CREATED: { schemaRef: 'payload.ProjectBillingConfigCreated.v1' },
  PROJECT_BILLING_CONFIG_UPDATED: { schemaRef: 'payload.ProjectBillingConfigUpdated.v1' },
  PROJECT_BILLING_CONFIG_DELETED: { schemaRef: 'payload.ProjectBillingConfigDeleted.v1' },
  PROJECT_BILLING_SCHEDULE_ENTRY_CREATED: { schemaRef: 'payload.ProjectBillingScheduleEntryCreated.v1' },
  PROJECT_BILLING_SCHEDULE_ENTRY_UPDATED: { schemaRef: 'payload.ProjectBillingScheduleEntryUpdated.v1' },
  PROJECT_BILLING_SCHEDULE_STATUS_CHANGED: { schemaRef: 'payload.ProjectBillingScheduleStatusChanged.v1' },
  PROJECT_BILLING_SCHEDULE_ENTRY_DELETED: { schemaRef: 'payload.ProjectBillingScheduleEntryDeleted.v1' },
  PROJECT_BILLING_PAYMENT_STATUS_CHANGED: { schemaRef: 'payload.ProjectBillingPaymentStatusChanged.v1' },
  INVENTORY_SALES_ORDER_CREATED: { schemaRef: 'payload.InventorySalesOrderCreated.v1' },
  INVENTORY_SALES_ORDER_UPDATED: { schemaRef: 'payload.InventorySalesOrderUpdated.v1' },
  INVENTORY_SALES_ORDER_DELETED: { schemaRef: 'payload.InventorySalesOrderDeleted.v1' },
  INVENTORY_PURCHASE_ORDER_CREATED: { schemaRef: 'payload.InventoryPurchaseOrderCreated.v1' },
  INVENTORY_PURCHASE_ORDER_UPDATED: { schemaRef: 'payload.InventoryPurchaseOrderUpdated.v1' },
  INVENTORY_PURCHASE_ORDER_DELETED: { schemaRef: 'payload.InventoryPurchaseOrderDeleted.v1' },
  INVENTORY_TRANSFER_DISPATCHED: { schemaRef: 'payload.InventoryTransferDispatched.v1' },
  INVENTORY_TRANSFER_RECEIVED: { schemaRef: 'payload.InventoryTransferReceived.v1' },
  INVENTORY_COUNT_SUBMITTED: { schemaRef: 'payload.InventoryCountSubmitted.v1' },
  INVENTORY_COUNT_APPROVED: { schemaRef: 'payload.InventoryCountApproved.v1' },
  CLIENT_ANNIVERSARY_UPCOMING: { schemaRef: 'payload.ClientAnniversaryUpcoming.v1' },
} as const satisfies Record<string, { readonly schemaRef: string }>;

export type WorkflowEventCatalog = typeof WORKFLOW_EVENT_CATALOG;

/** Every event type the DB catalog gives a `payload_schema_ref`. */
export type WorkflowCatalogEventType = keyof WorkflowEventCatalog;

export type WorkflowCatalogSchemaRef<T extends WorkflowCatalogEventType> = WorkflowEventCatalog[T]['schemaRef'];

export function isWorkflowCatalogEventType(eventType: string): eventType is WorkflowCatalogEventType {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_EVENT_CATALOG, eventType);
}

export function getWorkflowEventSchemaRef<T extends WorkflowCatalogEventType>(
  eventType: T
): WorkflowCatalogSchemaRef<T> {
  return WORKFLOW_EVENT_CATALOG[eventType].schemaRef;
}
