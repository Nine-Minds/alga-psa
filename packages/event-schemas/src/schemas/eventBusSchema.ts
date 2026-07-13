import { z } from 'zod';
import {
  emailProviderConnectedEventPayloadSchema,
  emailProviderDisconnectedEventPayloadSchema,
  inboundEmailReceivedEventPayloadSchema,
} from './domain/emailWorkflowSchemas';
import {
  appointmentAssignedEventPayloadSchema,
  appointmentCanceledEventPayloadSchema,
  appointmentCompletedEventPayloadSchema,
  appointmentCreatedEventPayloadSchema,
  appointmentNoShowEventPayloadSchema,
  appointmentRescheduledEventPayloadSchema,
  capacityThresholdReachedEventPayloadSchema,
  scheduleBlockCreatedEventPayloadSchema,
  scheduleBlockDeletedEventPayloadSchema,
  technicianArrivedEventPayloadSchema,
  technicianCheckedOutEventPayloadSchema,
  technicianDispatchedEventPayloadSchema,
  technicianEnRouteEventPayloadSchema,
} from './domain/schedulingEventSchemas';
import {
  projectApprovalGrantedEventPayloadSchema,
  projectApprovalRejectedEventPayloadSchema,
  projectApprovalRequestedEventPayloadSchema,
  projectCreatedEventPayloadSchema,
  projectStatusChangedEventPayloadSchema,
  projectTaskAssignedEventPayloadSchema as workflowProjectTaskAssignedEventPayloadSchema,
  projectTaskCompletedEventPayloadSchema,
  projectTaskCreatedEventPayloadSchema,
  projectTaskDependencyBlockedEventPayloadSchema,
  projectTaskDependencyUnblockedEventPayloadSchema,
  projectTaskStatusChangedEventPayloadSchema,
  projectUpdatedEventPayloadSchema,
} from './domain/projectEventSchemas';
import {
  contractCreatedEventPayloadSchema,
  contractRenewalUpcomingEventPayloadSchema,
  contractStatusChangedEventPayloadSchema,
  contractUpdatedEventPayloadSchema,
  creditExpiringEventPayloadSchema,
  creditNoteAppliedEventPayloadSchema,
  creditNoteCreatedEventPayloadSchema,
  creditNoteVoidedEventPayloadSchema,
  invoiceDueDateChangedEventPayloadSchema,
  invoiceFinalizedEventPayloadSchema,
  invoiceGeneratedEventPayloadSchema,
  invoiceOverdueEventPayloadSchema,
  invoiceSentEventPayloadSchema,
  invoiceStatusChangedEventPayloadSchema,
  invoiceWrittenOffEventPayloadSchema,
  paymentAppliedEventPayloadSchema,
  paymentFailedEventPayloadSchema,
  paymentRecordedEventPayloadSchema,
  paymentRefundedEventPayloadSchema,
  recurringBillingRunCompletedEventPayloadSchema,
  recurringBillingRunFailedEventPayloadSchema,
  recurringBillingRunStartedEventPayloadSchema,
} from './domain/billingEventSchemas';
import {
  clientArchivedEventPayloadSchema,
  clientCreatedEventPayloadSchema,
  clientDeletedEventPayloadSchema,
  clientMergedEventPayloadSchema,
  clientOwnerAssignedEventPayloadSchema,
  clientStatusChangedEventPayloadSchema,
  clientUpdatedEventPayloadSchema,
  contactArchivedEventPayloadSchema,
  contactCreatedEventPayloadSchema,
  contactDeletedEventPayloadSchema,
  contactMergedEventPayloadSchema,
  contactPrimarySetEventPayloadSchema,
  contactUpdatedEventPayloadSchema,
  interactionLoggedEventPayloadSchema,
  noteCreatedEventPayloadSchema,
  tagAppliedEventPayloadSchema,
  tagDefinitionCreatedEventPayloadSchema,
  tagDefinitionUpdatedEventPayloadSchema,
  tagRemovedEventPayloadSchema,
} from './domain/crmEventSchemas';
import {
  opportunityCreatedEventPayloadSchema,
  opportunityEscalatedEventPayloadSchema,
  opportunityNextActionOverdueEventPayloadSchema,
  opportunityStageChangedEventPayloadSchema,
  opportunityStalledEventPayloadSchema,
  opportunityStatusChangedEventPayloadSchema,
  opportunitySuggestionCreatedEventPayloadSchema,
} from './domain/opportunityEventSchemas';
import {
  documentAssociatedEventPayloadSchema,
  documentDeletedEventPayloadSchema,
  documentDetachedEventPayloadSchema,
  documentGeneratedEventPayloadSchema,
  documentSignatureExpiredEventPayloadSchema,
  documentSignatureRequestedEventPayloadSchema,
  documentSignedEventPayloadSchema,
  documentUpdatedEventPayloadSchema,
  documentUploadedEventPayloadSchema,
  kbArticleEventPayloadSchema,
} from './domain/documentEventSchemas';
import {
  csatAlertTriggeredEventPayloadSchema,
  emailBouncedEventPayloadSchema,
  emailComplaintReceivedEventPayloadSchema,
  emailDeliveredEventPayloadSchema,
  emailUnsubscribedEventPayloadSchema,
  inboundEmailReplyReceivedEventPayloadSchema,
  notificationDeliveredEventPayloadSchema,
  notificationFailedEventPayloadSchema,
  notificationReadEventPayloadSchema,
  notificationSentEventPayloadSchema,
  outboundEmailFailedEventPayloadSchema,
  outboundEmailQueuedEventPayloadSchema,
  outboundEmailSentEventPayloadSchema,
  surveyExpiredEventPayloadSchema,
  surveyReminderSentEventPayloadSchema,
  surveyResponseReceivedEventPayloadSchema,
  surveySentEventPayloadSchema,
} from './domain/communicationsEventSchemas';
import {
  externalMappingChangedEventPayloadSchema,
  integrationConnectedEventPayloadSchema,
  integrationDisconnectedEventPayloadSchema,
  integrationSyncCompletedEventPayloadSchema,
  integrationSyncFailedEventPayloadSchema,
  integrationSyncStartedEventPayloadSchema,
  integrationTokenExpiringEventPayloadSchema,
  integrationTokenRefreshFailedEventPayloadSchema,
  integrationWebhookReceivedEventPayloadSchema,
} from './domain/integrationEventSchemas';
import {
  assetAssignedEventPayloadSchema,
  assetCreatedEventPayloadSchema,
  assetUnassignedEventPayloadSchema,
  assetUpdatedEventPayloadSchema,
  assetWarrantyExpiringEventPayloadSchema,
  fileUploadedEventPayloadSchema,
  mediaProcessingFailedEventPayloadSchema,
  mediaProcessingSucceededEventPayloadSchema,
} from './domain/assetMediaEventSchemas';
import { maintenanceJobRequestedEventPayloadSchema } from './domain/maintenanceEventSchemas';
import {
  ticketApprovalGrantedEventPayloadSchema,
  ticketApprovalRejectedEventPayloadSchema,
  ticketApprovalRequestedEventPayloadSchema,
  ticketAssignedEventPayloadSchema,
  ticketAutoCloseWarningEventPayloadSchema,
  ticketClosedEventPayloadSchema,
  ticketCreatedEventPayloadSchema,
  ticketCustomerRepliedEventPayloadSchema,
  ticketEscalatedEventPayloadSchema,
  ticketInternalNoteAddedEventPayloadSchema,
  ticketMergedEventPayloadSchema,
  ticketMessageAddedEventPayloadSchema,
  ticketPriorityChangedEventPayloadSchema,
  ticketQueueChangedEventPayloadSchema,
  ticketReopenedEventPayloadSchema,
  ticketResponseStateChangedEventPayloadSchema,
  ticketSlaStageBreachedEventPayloadSchema,
  ticketSlaStageEnteredEventPayloadSchema,
  ticketSlaStageMetEventPayloadSchema,
  ticketSlaThresholdReachedEventPayloadSchema,
  ticketSplitEventPayloadSchema,
  ticketStatusChangedEventPayloadSchema,
  ticketTagsChangedEventPayloadSchema,
  ticketTimeEntryAddedEventPayloadSchema,
  ticketUnassignedEventPayloadSchema,
  ticketUpdatedEventPayloadSchema,
} from './domain/ticketEventSchemas';
import {
  inventoryPoReceivedEventPayloadSchema,
  inventoryPurchaseOrderSearchEventPayloadSchema,
  inventoryRmaCreatedEventPayloadSchema,
  inventorySalesOrderSearchEventPayloadSchema,
  inventorySoFulfilledEventPayloadSchema,
  inventoryStockLowEventPayloadSchema,
  inventoryStockUnitSearchEventPayloadSchema,
} from './domain/inventoryEventSchemas';

// Define event types
export const EVENT_TYPES = [
  // Tickets (existing + legacy)
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_AUTO_CLOSE_WARNING',
  // Maintenance / system (worker emits; server subscriber runs the handler)
  'MAINTENANCE_JOB_REQUESTED',
  'TICKET_ASSIGNED',
  'TICKET_ADDITIONAL_AGENT_ASSIGNED',
  'TICKET_COMMENT_ADDED',
  'TICKET_COMMENT_UPDATED',
  'TICKET_COMMENT_DELETED',
  'TICKET_DELETED',
  'TICKET_RESPONSE_STATE_CHANGED',

  // Tickets (domain expansion)
  'TICKET_STATUS_CHANGED',
  'TICKET_PRIORITY_CHANGED',
  'TICKET_UNASSIGNED',
  'TICKET_REOPENED',
  'TICKET_ESCALATED',
  'TICKET_QUEUE_CHANGED',
  'TICKET_MERGED',
  'TICKET_SPLIT',
  'TICKET_TAGS_CHANGED',
  'TICKET_MESSAGE_ADDED',
  'TICKET_CUSTOMER_REPLIED',
  'TICKET_INTERNAL_NOTE_ADDED',
  'TICKET_TIME_ENTRY_ADDED',
  'TICKET_SLA_STAGE_ENTERED',
  'TICKET_SLA_STAGE_MET',
  'TICKET_SLA_STAGE_BREACHED',
  'TICKET_SLA_THRESHOLD_REACHED',
  'TICKET_APPROVAL_REQUESTED',
  'TICKET_APPROVAL_GRANTED',
  'TICKET_APPROVAL_REJECTED',

  // Scheduling (legacy requests)
  'APPOINTMENT_REQUEST_CREATED',
  'APPOINTMENT_REQUEST_APPROVED',
  'APPOINTMENT_REQUEST_DECLINED',
  'APPOINTMENT_REQUEST_CANCELLED',

  // Scheduling (existing schedule entries)
  'SCHEDULE_ENTRY_CREATED',
  'SCHEDULE_ENTRY_UPDATED',
  'SCHEDULE_ENTRY_DELETED',

  // Scheduling (domain expansion)
  'APPOINTMENT_CREATED',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CANCELED',
  'APPOINTMENT_COMPLETED',
  'APPOINTMENT_NO_SHOW',
  'APPOINTMENT_ASSIGNED',
  'SCHEDULE_BLOCK_CREATED',
  'SCHEDULE_BLOCK_DELETED',
  'CAPACITY_THRESHOLD_REACHED',
  'TECHNICIAN_DISPATCHED',
  'TECHNICIAN_EN_ROUTE',
  'TECHNICIAN_ARRIVED',
  'TECHNICIAN_CHECKED_OUT',

  // Projects (existing + legacy)
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_CLOSED',
  'PROJECT_DELETED',
  'PROJECT_ASSIGNED',
  'PROJECT_PHASE_CREATED',
  'PROJECT_PHASE_UPDATED',
  'PROJECT_PHASE_DELETED',
  'PROJECT_TASK_UPDATED',
  'PROJECT_TASK_DELETED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
  'TASK_COMMENT_ADDED',
  'TASK_COMMENT_UPDATED',
  'PROJECT_TASK_COMMENT_CREATED',
  'PROJECT_TASK_COMMENT_UPDATED',
  'PROJECT_TASK_COMMENT_DELETED',

  // Projects (domain expansion)
  'PROJECT_STATUS_CHANGED',
  'PROJECT_TASK_CREATED',
  'PROJECT_TASK_STATUS_CHANGED',
  'PROJECT_TASK_COMPLETED',
  'PROJECT_TASK_DEPENDENCY_BLOCKED',
  'PROJECT_TASK_DEPENDENCY_UNBLOCKED',
  'PROJECT_APPROVAL_REQUESTED',
  'PROJECT_APPROVAL_GRANTED',
  'PROJECT_APPROVAL_REJECTED',

  // Time entries (legacy)
  'TIME_ENTRY_CREATED',
  'TIME_ENTRY_UPDATED',
  'TIME_ENTRY_DELETED',
  'TIME_ENTRY_SUBMITTED',
  'TIME_ENTRY_APPROVED',
  'TIME_ENTRY_CHANGES_REQUESTED',

  // Billing (existing + legacy)
  'INVOICE_CREATED',
  'INVOICE_UPDATED',
  'INVOICE_DELETED',
  'INVOICE_GENERATED',
  'INVOICE_FINALIZED',
  'INVOICE_ITEM_CREATED',
  'INVOICE_ITEM_UPDATED',
  'INVOICE_ITEM_DELETED',
  'INVOICE_ANNOTATION_CREATED',
  'INVOICE_ANNOTATION_UPDATED',
  'INVOICE_ANNOTATION_DELETED',

  // Billing (domain expansion)
  'INVOICE_SENT',
  'INVOICE_STATUS_CHANGED',
  'INVOICE_DUE_DATE_CHANGED',
  'INVOICE_OVERDUE',
  'INVOICE_WRITTEN_OFF',
  'PAYMENT_RECORDED',
  'PAYMENT_APPLIED',
  'PAYMENT_FAILED',
  'PAYMENT_REFUNDED',
  'CREDIT_NOTE_CREATED',
  'CREDIT_NOTE_APPLIED',
  'CREDIT_NOTE_VOIDED',
  'CREDIT_EXPIRING',
  'CONTRACT_CREATED',
  'CONTRACT_UPDATED',
  'CONTRACT_DELETED',
  'CONTRACT_STATUS_CHANGED',
  'CONTRACT_RENEWAL_UPCOMING',
  'CLIENT_CONTRACT_CREATED',
  'CLIENT_CONTRACT_UPDATED',
  'CLIENT_CONTRACT_DELETED',
  'RECURRING_BILLING_RUN_STARTED',
  'RECURRING_BILLING_RUN_COMPLETED',
  'RECURRING_BILLING_RUN_FAILED',

  // CRM (domain expansion)
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CLIENT_STATUS_CHANGED',
  'CLIENT_OWNER_ASSIGNED',
  'CLIENT_MERGED',
  'CLIENT_ARCHIVED',
  'CLIENT_DELETED',
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'CONTACT_PRIMARY_SET',
  'CONTACT_ARCHIVED',
  'CONTACT_DELETED',
  'CONTACT_MERGED',
  'INTERACTION_LOGGED',
  'INTERACTION_CREATED',
  'INTERACTION_UPDATED',
  'INTERACTION_DELETED',
  'NOTE_CREATED',
  'TAG_DEFINITION_CREATED',
  'TAG_DEFINITION_UPDATED',
  'TAG_DEFINITION_DELETED',
  'TAG_APPLIED',
  'TAG_REMOVED',
  'BOARD_CREATED',
  'BOARD_UPDATED',
  'BOARD_DELETED',
  'CATEGORY_CREATED',
  'CATEGORY_UPDATED',
  'CATEGORY_DELETED',
  'STATUS_CREATED',
  'STATUS_UPDATED',
  'STATUS_DELETED',

  // Opportunities
  'OPPORTUNITY_CREATED',
  'OPPORTUNITY_STAGE_CHANGED',
  'OPPORTUNITY_STATUS_CHANGED',
  'OPPORTUNITY_STALLED',
  'OPPORTUNITY_ESCALATED',
  'OPPORTUNITY_NEXT_ACTION_OVERDUE',
  'OPPORTUNITY_SUGGESTION_CREATED',

  // Users
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DELETED',
  'USER_ROLES_UPDATED',

  // Documents (domain expansion)
  'DOCUMENT_UPLOADED',
  'DOCUMENT_UPDATED',
  'DOCUMENT_DELETED',
  'DOCUMENT_ASSOCIATED',
  'DOCUMENT_DETACHED',
  'DOCUMENT_GENERATED',
  'DOCUMENT_SIGNATURE_REQUESTED',
  'DOCUMENT_SIGNED',
  'DOCUMENT_SIGNATURE_EXPIRED',
  'KB_ARTICLE_CREATED',
  'KB_ARTICLE_UPDATED',
  'KB_ARTICLE_DELETED',
  'SERVICE_CATALOG_CREATED',
  'SERVICE_CATALOG_UPDATED',
  'SERVICE_CATALOG_DELETED',
  'SERVICE_REQUEST_SUBMISSION_CREATED',
  'SERVICE_REQUEST_SUBMISSION_UPDATED',
  'SERVICE_REQUEST_SUBMISSION_DELETED',
  'SERVICE_REQUEST_DEFINITION_CREATED',
  'SERVICE_REQUEST_DEFINITION_UPDATED',
  'SERVICE_REQUEST_DEFINITION_DELETED',
  'WORKFLOW_TASK_CREATED',
  'WORKFLOW_TASK_UPDATED',
  'WORKFLOW_TASK_DELETED',
  'WORKFLOW_TASK_ASSIGNMENT_CHANGED',

  // Email providers + inbound email (already present)
  'INBOUND_EMAIL_RECEIVED',
  'EMAIL_PROVIDER_CONNECTED',
  'EMAIL_PROVIDER_DISCONNECTED',

  // Email (domain expansion)
  'INBOUND_EMAIL_REPLY_RECEIVED',
  'OUTBOUND_EMAIL_QUEUED',
  'OUTBOUND_EMAIL_SENT',
  'OUTBOUND_EMAIL_FAILED',
  'EMAIL_DELIVERED',
  'EMAIL_BOUNCED',
  'EMAIL_COMPLAINT_RECEIVED',
  'EMAIL_UNSUBSCRIBED',

  // Notifications (domain expansion)
  'NOTIFICATION_SENT',
  'NOTIFICATION_DELIVERED',
  'NOTIFICATION_FAILED',
  'NOTIFICATION_READ',

  // Surveys/CSAT (legacy + domain expansion)
  'SURVEY_INVITATION_SENT',
  'SURVEY_RESPONSE_SUBMITTED',
  'SURVEY_NEGATIVE_RESPONSE',
  'SURVEY_SENT',
  'SURVEY_RESPONSE_RECEIVED',
  'SURVEY_REMINDER_SENT',
  'SURVEY_EXPIRED',
  'CSAT_ALERT_TRIGGERED',

  // Integrations (existing)
  'ACCOUNTING_EXPORT_COMPLETED',
  'ACCOUNTING_EXPORT_FAILED',
  'CALENDAR_SYNC_STARTED',
  'CALENDAR_SYNC_COMPLETED',
  'CALENDAR_SYNC_FAILED',
  'CALENDAR_CONFLICT_DETECTED',

  // Integrations (domain expansion)
  'INTEGRATION_SYNC_STARTED',
  'INTEGRATION_SYNC_COMPLETED',
  'INTEGRATION_SYNC_FAILED',
  'INTEGRATION_WEBHOOK_RECEIVED',
  'INTEGRATION_CONNECTED',
  'INTEGRATION_DISCONNECTED',
  'INTEGRATION_TOKEN_EXPIRING',
  'INTEGRATION_TOKEN_REFRESH_FAILED',
  'EXTERNAL_MAPPING_CHANGED',

  // Messaging + mentions (legacy)
  'MESSAGE_SENT',
  'USER_MENTIONED_IN_DOCUMENT',

  // Assets + media (domain expansion)
  'ASSET_CREATED',
  'ASSET_UPDATED',
  'ASSET_DELETED',
  'ASSET_ASSIGNED',
  'ASSET_UNASSIGNED',
  'ASSET_WARRANTY_EXPIRING',
  'FILE_UPLOADED',
  'MEDIA_PROCESSING_SUCCEEDED',
  'MEDIA_PROCESSING_FAILED',

  // RMM Integration Events
  'RMM_DEVICE_CREATED',
  'RMM_DEVICE_UPDATED',
  'RMM_DEVICE_DELETED',
  'RMM_DEVICE_ONLINE',
  'RMM_DEVICE_OFFLINE',
  'RMM_ALERT_TRIGGERED',
  'RMM_ALERT_RESOLVED',
  'RMM_SYNC_STARTED',
  'RMM_SYNC_COMPLETED',
  'RMM_SYNC_FAILED',
  'RMM_WEBHOOK_RECEIVED',

  // Inventory
  'INVENTORY_STOCK_LOW',
  'INVENTORY_PO_RECEIVED',
  'INVENTORY_SO_FULFILLED',
  'INVENTORY_RMA_CREATED',
  'INVENTORY_SALES_ORDER_CREATED',
  'INVENTORY_SALES_ORDER_UPDATED',
  'INVENTORY_SALES_ORDER_DELETED',
  'INVENTORY_PURCHASE_ORDER_CREATED',
  'INVENTORY_PURCHASE_ORDER_UPDATED',
  'INVENTORY_PURCHASE_ORDER_DELETED',
  'INVENTORY_STOCK_UNIT_CREATED',
  'INVENTORY_STOCK_UNIT_UPDATED',
  'INVENTORY_STOCK_UNIT_DELETED',

  // Generic events
  'CUSTOM_EVENT',
  'UNKNOWN',
] as const satisfies readonly [string, ...string[]];

export const EventTypeEnum = z.enum(EVENT_TYPES);

export type EventType = z.infer<typeof EventTypeEnum>;

// Base payload schema with tenant information
export const BasePayloadSchema = z.object({
  tenantId: z.string().uuid(),
});

const TicketNotificationSuppressionSchema = {
  suppressContactNotifications: z.boolean().optional().default(false),
  suppressInternalNotifications: z.boolean().optional().default(false),
};

// Base event schema
export const BaseEventSchema = z.object({
  id: z.string().uuid(),
  eventType: EventTypeEnum,
  timestamp: z.string().datetime(),
  payload: z.unknown(),
});

// Ticket event payload schema
export const TicketEventPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  userId: z.string().uuid(), // The user being assigned to the ticket
  assignedByUserId: z.string().uuid().optional(), // The user who performed the action
  changes: z.record(z.unknown()).optional(),
  ...TicketNotificationSuppressionSchema,
  comment: z.object({
    id: z.string().uuid(),
    content: z.string(),
    author: z.string(),
    isInternal: z.boolean().optional(),
    authorType: z.enum(['internal', 'client', 'unknown']).optional(),
  }).optional(),
});

// Ticket additional agent event payload schema
export const TicketAdditionalAgentPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  primaryAgentId: z.string().uuid(),      // Existing primary agent
  additionalAgentId: z.string().uuid(),   // New additional agent
  assignedByUserId: z.string().uuid(),    // Who performed the action
});

// Project event payload schema
export const ProjectEventPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  changes: z.record(z.unknown()).optional(),
  assignedTo: z.string().uuid().optional(),
});

export const ProjectClosedPayloadSchema = ProjectEventPayloadSchema.extend({
  changes: z.object({
    status: z.object({
      is_closed: z.literal(true),
    }),
  }),
});

export const ProjectPhaseEventPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  phaseId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  timestamp: z.string().datetime().optional(),
  changes: z.record(z.unknown()).optional(),
});

// Project task event payload schema
export const ProjectTaskEventPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  assignedToId: z.string().uuid(),
  assignedToType: z.enum(['user', 'team']),
  assignedByUserId: z.string().uuid().optional(),
  assignedByName: z.string().optional(),
  assignedAt: z.string().datetime().optional(),
});

// Project task additional agent event payload schema
export const ProjectTaskAdditionalAgentPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  primaryAgentId: z.string().uuid(),      // Existing primary agent
  additionalAgentId: z.string().uuid(),   // New additional agent
  assignedByUserId: z.string().uuid(),    // Who performed the action
});

export const ProjectTaskSearchEventPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  // Optional: the task's (destination) phase. Carried so webhook/workflow
  // consumers can react to phase moves without re-querying.
  phaseId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  timestamp: z.string().datetime().optional(),
  changes: z.record(z.unknown()).optional(),
});

// Task comment event payload schemas
export const TaskCommentAddedPayloadSchema = BasePayloadSchema.extend({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(), // User who created the comment
  taskCommentId: z.string().uuid(),
  taskName: z.string(),
  commentContent: z.string(), // BlockNote JSON with embedded mentions
  isUpdate: z.boolean().optional(), // Always false for ADDED
});

export const TaskCommentUpdatedPayloadSchema = BasePayloadSchema.extend({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(), // User who updated the comment
  taskCommentId: z.string().uuid(),
  taskName: z.string(),
  oldCommentContent: z.string(), // Old BlockNote JSON
  newCommentContent: z.string(), // New BlockNote JSON
  isUpdate: z.boolean().optional(), // Always true for UPDATED
});

export const TaskCommentDeletedPayloadSchema = BasePayloadSchema.extend({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  taskCommentId: z.string().uuid(),
  taskName: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

// Ticket comment delete event payload schema.
// commentId is top-level so the search index subscriber's extractObjectId can resolve it.
export const TicketCommentDeletedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  commentId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  isInternal: z.boolean().optional(),
});

// Ticket comment update event payload schema
export const TicketCommentUpdatedPayloadSchema = TicketEventPayloadSchema.extend({
  oldComment: z.object({
    id: z.string().uuid(),
    content: z.string(),
    author: z.string(),
    isInternal: z.boolean().optional(),
  }).optional(),
  newComment: z.object({
    id: z.string().uuid(),
    content: z.string(),
    author: z.string(),
    isInternal: z.boolean().optional(),
  }).optional(),
});

// Time entry event payload schema
export const TimeEntryEventPayloadSchema = BasePayloadSchema.extend({
  timeEntryId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  workItemId: z.string().nullable().optional(),
  workItemType: z.string().nullable().optional(),
  approvedBy: z.string().uuid().optional(),
  requestedBy: z.string().uuid().optional(),
  reason: z.string().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

// Invoice event payload schema
export const InvoiceEventPayloadSchema = BasePayloadSchema.extend({
  invoiceId: z.string().uuid(),
  clientId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number(),
});

export const InvoiceSearchEventPayloadSchema = BasePayloadSchema.extend({
  invoiceId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const InvoiceItemEventPayloadSchema = BasePayloadSchema.extend({
  invoiceId: z.string().uuid(),
  itemId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const InvoiceAnnotationEventPayloadSchema = BasePayloadSchema.extend({
  invoiceId: z.string().uuid(),
  annotationId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const ContractSearchEventPayloadSchema = BasePayloadSchema.extend({
  contractId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  status: z.string().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const ClientContractEventPayloadSchema = BasePayloadSchema.extend({
  clientContractId: z.string().uuid(),
  contractId: z.string().uuid(),
  clientId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const AssetDeletedPayloadSchema = BasePayloadSchema.extend({
  assetId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  timestamp: z.string().datetime().optional(),
});

export const ServiceCatalogEventPayloadSchema = BasePayloadSchema.extend({
  serviceId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  itemKind: z.enum(['service', 'product']).optional(),
  changedFields: z.array(z.string()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const ServiceRequestSubmissionEventPayloadSchema = BasePayloadSchema.extend({
  submissionId: z.string().uuid(),
  definitionId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  requesterUserId: z.string().uuid().optional(),
  executionStatus: z.string().optional(),
  changedFields: z.array(z.string()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const ServiceRequestDefinitionEventPayloadSchema = BasePayloadSchema.extend({
  definitionId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  lifecycleState: z.string().optional(),
  changedFields: z.array(z.string()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const WorkflowTaskEventPayloadSchema = BasePayloadSchema.extend({
  taskId: z.string().min(1),
  userId: z.string().uuid().optional(),
  status: z.string().optional(),
  assignedUserIds: z.array(z.string().uuid()).optional(),
  changedFields: z.array(z.string()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const InteractionEventPayloadSchema = BasePayloadSchema.extend({
  interactionId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  changedFields: z.array(z.string()).optional(),
  timestamp: z.string().datetime().optional(),
});

// Client event payload schema
export const ClientEventPayloadSchema = BasePayloadSchema.extend({
  clientId: z.string().uuid(),
  userId: z.string().uuid().optional(), // User might not always be available for system-triggered events
  changes: z.record(z.unknown()).optional(), // Details of what changed
});

export const UserEventPayloadSchema = BasePayloadSchema.extend({
  userId: z.string().uuid(),
  userType: z.enum(['internal', 'client']).optional(),
  email: z.string().email().optional(),
  changedFields: z.array(z.string()).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  actorUserId: z.string().uuid().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().optional(),
});

// Custom event payload schema for test events
export const CustomEventPayloadSchema = BasePayloadSchema.extend({
  userId: z.string().optional(),
  eventName: z.string().optional(),
}).catchall(z.unknown()); // Allow any additional properties

// Inbound email event payload schema
export const InboundEmailEventPayloadSchema = BasePayloadSchema.extend({
  providerId: z.string(),
  emailData: z.object({
    id: z.string(),
    subject: z.string(),
    from: z.object({
      email: z.string().email(),
      name: z.string().optional(),
    }),
    to: z.array(z.object({
      email: z.string().email(),
      name: z.string().optional(),
    })),
    body: z.object({
      text: z.string(),
      html: z.string().optional(),
    }),
    receivedAt: z.string().datetime(),
    attachments: z.array(z.object({
      id: z.string(),
      name: z.string(),
      contentType: z.string(),
      size: z.number(),
      contentId: z.string().optional(),
      isInline: z.boolean().optional(),
      content: z.string().optional(),
    })).optional(),
    threadId: z.string().optional(),
    inReplyTo: z.string().optional(),
    references: z.array(z.string()).optional(),
    rawMime: z.string().optional(),
    rawMimeBase64: z.string().optional(),
    sourceMimeBase64: z.string().optional(),
    rawSourceBase64: z.string().optional(),
    ingressSkipReasons: z.array(z.object({
      type: z.enum(['attachment', 'raw_mime']),
      reason: z.enum([
        'attachment_over_max_bytes',
        'attachment_count_exceeded',
        'attachment_total_bytes_exceeded',
        'raw_mime_over_max_bytes',
      ]),
      attachmentId: z.string().optional(),
      attachmentName: z.string().optional(),
      size: z.number(),
      cap: z.number(),
    })).optional(),
  }),
});

export const AccountingExportEventPayloadSchema = BasePayloadSchema.extend({
  batchId: z.string().uuid(),
  adapterType: z.string(),
  deliveredLineIds: z.array(z.string().uuid()).optional(),
  error: z
    .object({
      message: z.string(),
      status: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
});

// Schedule entry event payload schema
export const ScheduleEntryEventPayloadSchema = BasePayloadSchema.extend({
  entryId: z.string().uuid(),
  userId: z.string().uuid(),
  changes: z.record(z.unknown()).optional(),
});

export const BoardEventPayloadSchema = BasePayloadSchema.extend({
  boardId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const CategoryEventPayloadSchema = BasePayloadSchema.extend({
  categoryId: z.string().uuid(),
  boardId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

// Status reference-data event payload. statusId is top-level so the search
// index subscriber's extractObjectId can resolve it on every STATUS_* event.
export const StatusEventPayloadSchema = BasePayloadSchema.extend({
  statusId: z.string().uuid(),
  statusType: z.enum(['ticket', 'project', 'project_task', 'interaction']).optional(),
  boardId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime().optional(),
});

export const TagDefinitionDeletedPayloadSchema = BasePayloadSchema.extend({
  tagId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  timestamp: z.string().datetime().optional(),
});

// Calendar sync event payload schema
export const CalendarSyncEventPayloadSchema = BasePayloadSchema.extend({
  calendarProviderId: z.string().uuid(),
  scheduleEntryId: z.string().uuid().optional(),
  externalEventId: z.string().optional(),
  syncDirection: z.enum(['to_external', 'from_external', 'bidirectional']),
  error: z
    .object({
      message: z.string(),
      code: z.string().optional(),
    })
    .optional(),
});

// Calendar conflict event payload schema
export const CalendarConflictEventPayloadSchema = BasePayloadSchema.extend({
  mappingId: z.string().uuid(),
  calendarProviderId: z.string().uuid(),
  scheduleEntryId: z.string().uuid(),
  externalEventId: z.string(),
  algaLastModified: z.string().datetime(),
  externalLastModified: z.string().datetime(),
});

export const SurveyInvitationSentPayloadSchema = BasePayloadSchema.extend({
  invitationId: z.string().uuid(),
  ticketId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  surveyTokenHash: z.string(),
});

export const SurveyResponseSubmittedPayloadSchema = BasePayloadSchema.extend({
  responseId: z.string().uuid(),
  ticketId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  rating: z.number(),
  hasComment: z.boolean(),
});

export const SurveyNegativeResponsePayloadSchema = BasePayloadSchema.extend({
  responseId: z.string().uuid(),
  ticketId: z.string().uuid(),
  ticketNumber: z.string(),
  companyId: z.string().uuid().optional(),
  companyName: z.string().optional(),
  contactName: z.string().optional(),
  rating: z.number(),
  comment: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
});

export const TicketResponseStateChangedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  previousState: z.enum(['awaiting_client', 'awaiting_internal']).nullable(),
  newState: z.enum(['awaiting_client', 'awaiting_internal']).nullable(),
  trigger: z.enum(['comment', 'manual', 'close']),
});

export const AppointmentRequestEventPayloadSchema = BasePayloadSchema.extend({
  appointmentRequestId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  clientUserId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid(),
  serviceName: z.string(),
  requestedDate: z.string(),
  requestedTime: z.string(),
  requestedDuration: z.number(),
  preferredAssignedUserId: z.string().uuid().optional(),
  isAuthenticated: z.boolean(),
  requesterName: z.string().nullable().optional(),
  requesterEmail: z.string(),
  requesterPhone: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  ticketId: z.string().uuid().optional(),
  description: z.string().optional(),
  approvedByUserId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().optional(),
  scheduleEntryId: z.string().uuid().optional(),
  declineReason: z.string().optional(),
});

// Document mention event payload schema
export const DocumentMentionPayloadSchema = BasePayloadSchema.extend({
  documentId: z.string().uuid(),
  documentName: z.string(),
  userId: z.string().uuid(), // User who updated the document
  content: z.string(), // Document content with mentions
  oldContent: z.unknown().optional(), // Can be array (BlockNote blocks) or string
  newContent: z.string().optional(),
  isUpdate: z.boolean().optional(),
  changes: z.record(z.unknown()).optional(),
});

// Message sent event payload schema
export const MessageSentPayloadSchema = BasePayloadSchema.extend({
  messageId: z.string().uuid(),
  senderId: z.string().uuid(),
  recipientId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  messagePreview: z.string(),
  senderName: z.string(),
});

// RMM Device event payload schema
export const RmmDeviceEventPayloadSchema = BasePayloadSchema.extend({
  integrationId: z.string().uuid(),
  provider: z.string(), // 'ninjaone', etc.
  assetId: z.string().uuid().optional(), // Alga asset ID if mapped
  externalDeviceId: z.string(),
  externalOrganizationId: z.string().optional(),
  deviceName: z.string().optional(),
  deviceType: z.string().optional(), // 'workstation', 'server', etc.
  changes: z.record(z.unknown()).optional(),
});

// RMM Device status event payload schema
export const RmmDeviceStatusEventPayloadSchema = RmmDeviceEventPayloadSchema.extend({
  previousStatus: z.string().optional(),
  currentStatus: z.string(), // 'online', 'offline'
  lastSeenAt: z.string().datetime().optional(),
});

// RMM Alert event payload schema
export const RmmAlertEventPayloadSchema = BasePayloadSchema.extend({
  integrationId: z.string().uuid(),
  provider: z.string(),
  alertId: z.string().uuid(),
  externalAlertId: z.string(),
  externalDeviceId: z.string().optional(),
  assetId: z.string().uuid().optional(),
  ticketId: z.string().uuid().optional(),
  severity: z.string(), // 'critical', 'major', 'moderate', 'minor', 'none'
  priority: z.string().optional(),
  message: z.string().optional(),
  sourceType: z.string().optional(),
  alertClass: z.string().optional(),
  triggeredAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
});

// RMM Sync event payload schema
export const RmmSyncEventPayloadSchema = BasePayloadSchema.extend({
  integrationId: z.string().uuid(),
  provider: z.string(),
  syncType: z.enum(['full', 'incremental', 'organizations', 'devices', 'alerts']),
  itemsProcessed: z.number().optional(),
  itemsCreated: z.number().optional(),
  itemsUpdated: z.number().optional(),
  itemsFailed: z.number().optional(),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }).optional(),
});

// RMM Webhook event payload schema
export const RmmWebhookEventPayloadSchema = BasePayloadSchema.extend({
  integrationId: z.string().uuid(),
  provider: z.string(),
  webhookEventType: z.string(), // Provider-specific event type
  externalDeviceId: z.string().optional(),
  assetId: z.string().uuid().optional(),
  rawPayload: z.record(z.unknown()), // Full webhook payload for processing
});

const TicketCreatedPayloadSchema = z.union([TicketEventPayloadSchema, ticketCreatedEventPayloadSchema]);
const TicketUpdatedPayloadSchema = z.union([TicketEventPayloadSchema, ticketUpdatedEventPayloadSchema]);
const TicketClosedPayloadSchema = z.union([TicketEventPayloadSchema, ticketClosedEventPayloadSchema]);
const TicketAutoCloseWarningPayloadSchema = z.union([TicketEventPayloadSchema, ticketAutoCloseWarningEventPayloadSchema]);
const MaintenanceJobRequestedPayloadSchema = maintenanceJobRequestedEventPayloadSchema;
const TicketAssignedPayloadSchema = z.union([TicketEventPayloadSchema, ticketAssignedEventPayloadSchema]);
const TicketResponseStateChangedPayloadSchemaV2 = z.union([
  TicketResponseStateChangedPayloadSchema,
  ticketResponseStateChangedEventPayloadSchema,
]);
const ProjectCreatedPayloadSchema = z.union([ProjectEventPayloadSchema, projectCreatedEventPayloadSchema]);
const ProjectUpdatedPayloadSchema = z.union([ProjectEventPayloadSchema, projectUpdatedEventPayloadSchema]);
const ProjectTaskAssignedPayloadSchema = z.union([
  ProjectTaskEventPayloadSchema,
  workflowProjectTaskAssignedEventPayloadSchema,
]);
const InvoiceGeneratedPayloadSchema = z.union([InvoiceEventPayloadSchema, invoiceGeneratedEventPayloadSchema]);
const InvoiceFinalizedPayloadSchema = z.union([InvoiceEventPayloadSchema, invoiceFinalizedEventPayloadSchema]);
const ContractCreatedPayloadSchema = z.union([contractCreatedEventPayloadSchema, ContractSearchEventPayloadSchema]);
const ContractUpdatedPayloadSchema = z.union([contractUpdatedEventPayloadSchema, ContractSearchEventPayloadSchema]);
const ContractStatusChangedPayloadSchema = z.union([contractStatusChangedEventPayloadSchema, ContractSearchEventPayloadSchema]);
const InboundEmailReceivedPayloadSchema = z.union([
  InboundEmailEventPayloadSchema,
  inboundEmailReceivedEventPayloadSchema,
]);

// Map event types to their payload schemas
export const EventPayloadSchemas = {
  // Tickets (existing + legacy)
  TICKET_CREATED: TicketCreatedPayloadSchema,
  TICKET_UPDATED: TicketUpdatedPayloadSchema,
  TICKET_CLOSED: TicketClosedPayloadSchema,
  TICKET_AUTO_CLOSE_WARNING: TicketAutoCloseWarningPayloadSchema,
  MAINTENANCE_JOB_REQUESTED: MaintenanceJobRequestedPayloadSchema,
  TICKET_DELETED: TicketEventPayloadSchema,
  TICKET_ASSIGNED: TicketAssignedPayloadSchema,
  TICKET_ADDITIONAL_AGENT_ASSIGNED: TicketAdditionalAgentPayloadSchema,
  TICKET_COMMENT_ADDED: TicketEventPayloadSchema,
  TICKET_COMMENT_UPDATED: TicketCommentUpdatedPayloadSchema,
  TICKET_COMMENT_DELETED: TicketCommentDeletedPayloadSchema,
  TICKET_RESPONSE_STATE_CHANGED: TicketResponseStateChangedPayloadSchemaV2,

  // Tickets (domain expansion)
  TICKET_STATUS_CHANGED: ticketStatusChangedEventPayloadSchema,
  TICKET_PRIORITY_CHANGED: ticketPriorityChangedEventPayloadSchema,
  TICKET_UNASSIGNED: ticketUnassignedEventPayloadSchema,
  TICKET_REOPENED: ticketReopenedEventPayloadSchema,
  TICKET_ESCALATED: ticketEscalatedEventPayloadSchema,
  TICKET_QUEUE_CHANGED: ticketQueueChangedEventPayloadSchema,
  TICKET_MERGED: ticketMergedEventPayloadSchema,
  TICKET_SPLIT: ticketSplitEventPayloadSchema,
  TICKET_TAGS_CHANGED: ticketTagsChangedEventPayloadSchema,
  TICKET_MESSAGE_ADDED: ticketMessageAddedEventPayloadSchema,
  TICKET_CUSTOMER_REPLIED: ticketCustomerRepliedEventPayloadSchema,
  TICKET_INTERNAL_NOTE_ADDED: ticketInternalNoteAddedEventPayloadSchema,
  TICKET_TIME_ENTRY_ADDED: ticketTimeEntryAddedEventPayloadSchema,
  TICKET_SLA_STAGE_ENTERED: ticketSlaStageEnteredEventPayloadSchema,
  TICKET_SLA_STAGE_MET: ticketSlaStageMetEventPayloadSchema,
  TICKET_SLA_STAGE_BREACHED: ticketSlaStageBreachedEventPayloadSchema,
  TICKET_SLA_THRESHOLD_REACHED: ticketSlaThresholdReachedEventPayloadSchema,
  TICKET_APPROVAL_REQUESTED: ticketApprovalRequestedEventPayloadSchema,
  TICKET_APPROVAL_GRANTED: ticketApprovalGrantedEventPayloadSchema,
  TICKET_APPROVAL_REJECTED: ticketApprovalRejectedEventPayloadSchema,

  // Scheduling (legacy requests)
  APPOINTMENT_REQUEST_CREATED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_APPROVED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_DECLINED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_CANCELLED: AppointmentRequestEventPayloadSchema,

  // Scheduling (existing schedule entries)
  SCHEDULE_ENTRY_CREATED: ScheduleEntryEventPayloadSchema,
  SCHEDULE_ENTRY_UPDATED: ScheduleEntryEventPayloadSchema,
  SCHEDULE_ENTRY_DELETED: ScheduleEntryEventPayloadSchema,

  // Scheduling (domain expansion)
  APPOINTMENT_CREATED: appointmentCreatedEventPayloadSchema,
  APPOINTMENT_RESCHEDULED: appointmentRescheduledEventPayloadSchema,
  APPOINTMENT_CANCELED: appointmentCanceledEventPayloadSchema,
  APPOINTMENT_COMPLETED: appointmentCompletedEventPayloadSchema,
  APPOINTMENT_NO_SHOW: appointmentNoShowEventPayloadSchema,
  APPOINTMENT_ASSIGNED: appointmentAssignedEventPayloadSchema,
  SCHEDULE_BLOCK_CREATED: scheduleBlockCreatedEventPayloadSchema,
  SCHEDULE_BLOCK_DELETED: scheduleBlockDeletedEventPayloadSchema,
  CAPACITY_THRESHOLD_REACHED: capacityThresholdReachedEventPayloadSchema,
  TECHNICIAN_DISPATCHED: technicianDispatchedEventPayloadSchema,
  TECHNICIAN_EN_ROUTE: technicianEnRouteEventPayloadSchema,
  TECHNICIAN_ARRIVED: technicianArrivedEventPayloadSchema,
  TECHNICIAN_CHECKED_OUT: technicianCheckedOutEventPayloadSchema,

  // Projects (existing + legacy)
  PROJECT_CREATED: ProjectCreatedPayloadSchema,
  PROJECT_UPDATED: ProjectUpdatedPayloadSchema,
  PROJECT_CLOSED: ProjectClosedPayloadSchema,
  PROJECT_DELETED: ProjectEventPayloadSchema,
  PROJECT_ASSIGNED: ProjectEventPayloadSchema,
  PROJECT_PHASE_CREATED: ProjectPhaseEventPayloadSchema,
  PROJECT_PHASE_UPDATED: ProjectPhaseEventPayloadSchema,
  PROJECT_PHASE_DELETED: ProjectPhaseEventPayloadSchema,
  PROJECT_TASK_UPDATED: ProjectTaskSearchEventPayloadSchema,
  PROJECT_TASK_DELETED: ProjectTaskSearchEventPayloadSchema,
  PROJECT_TASK_ASSIGNED: ProjectTaskAssignedPayloadSchema,
  PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED: ProjectTaskAdditionalAgentPayloadSchema,
  TASK_COMMENT_ADDED: TaskCommentAddedPayloadSchema,
  TASK_COMMENT_UPDATED: TaskCommentUpdatedPayloadSchema,
  PROJECT_TASK_COMMENT_CREATED: TaskCommentAddedPayloadSchema,
  PROJECT_TASK_COMMENT_UPDATED: TaskCommentUpdatedPayloadSchema,
  PROJECT_TASK_COMMENT_DELETED: TaskCommentDeletedPayloadSchema,

  // Projects (domain expansion)
  PROJECT_STATUS_CHANGED: projectStatusChangedEventPayloadSchema,
  PROJECT_TASK_CREATED: projectTaskCreatedEventPayloadSchema,
  PROJECT_TASK_STATUS_CHANGED: projectTaskStatusChangedEventPayloadSchema,
  PROJECT_TASK_COMPLETED: projectTaskCompletedEventPayloadSchema,
  PROJECT_TASK_DEPENDENCY_BLOCKED: projectTaskDependencyBlockedEventPayloadSchema,
  PROJECT_TASK_DEPENDENCY_UNBLOCKED: projectTaskDependencyUnblockedEventPayloadSchema,
  PROJECT_APPROVAL_REQUESTED: projectApprovalRequestedEventPayloadSchema,
  PROJECT_APPROVAL_GRANTED: projectApprovalGrantedEventPayloadSchema,
  PROJECT_APPROVAL_REJECTED: projectApprovalRejectedEventPayloadSchema,

  // Time entries (legacy)
  TIME_ENTRY_CREATED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_UPDATED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_DELETED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_SUBMITTED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_APPROVED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_CHANGES_REQUESTED: TimeEntryEventPayloadSchema,

  // Billing (existing + legacy)
  INVOICE_CREATED: InvoiceSearchEventPayloadSchema,
  INVOICE_UPDATED: InvoiceSearchEventPayloadSchema,
  INVOICE_DELETED: InvoiceSearchEventPayloadSchema,
  INVOICE_GENERATED: InvoiceGeneratedPayloadSchema,
  INVOICE_FINALIZED: InvoiceFinalizedPayloadSchema,
  INVOICE_ITEM_CREATED: InvoiceItemEventPayloadSchema,
  INVOICE_ITEM_UPDATED: InvoiceItemEventPayloadSchema,
  INVOICE_ITEM_DELETED: InvoiceItemEventPayloadSchema,
  INVOICE_ANNOTATION_CREATED: InvoiceAnnotationEventPayloadSchema,
  INVOICE_ANNOTATION_UPDATED: InvoiceAnnotationEventPayloadSchema,
  INVOICE_ANNOTATION_DELETED: InvoiceAnnotationEventPayloadSchema,

  // Billing (domain expansion)
  INVOICE_SENT: invoiceSentEventPayloadSchema,
  INVOICE_STATUS_CHANGED: invoiceStatusChangedEventPayloadSchema,
  INVOICE_DUE_DATE_CHANGED: invoiceDueDateChangedEventPayloadSchema,
  INVOICE_OVERDUE: invoiceOverdueEventPayloadSchema,
  INVOICE_WRITTEN_OFF: invoiceWrittenOffEventPayloadSchema,
  PAYMENT_RECORDED: paymentRecordedEventPayloadSchema,
  PAYMENT_APPLIED: paymentAppliedEventPayloadSchema,
  PAYMENT_FAILED: paymentFailedEventPayloadSchema,
  PAYMENT_REFUNDED: paymentRefundedEventPayloadSchema,
  CREDIT_NOTE_CREATED: creditNoteCreatedEventPayloadSchema,
  CREDIT_NOTE_APPLIED: creditNoteAppliedEventPayloadSchema,
  CREDIT_NOTE_VOIDED: creditNoteVoidedEventPayloadSchema,
  CREDIT_EXPIRING: creditExpiringEventPayloadSchema,
  CONTRACT_CREATED: ContractCreatedPayloadSchema,
  CONTRACT_UPDATED: ContractUpdatedPayloadSchema,
  CONTRACT_DELETED: ContractSearchEventPayloadSchema,
  CONTRACT_STATUS_CHANGED: ContractStatusChangedPayloadSchema,
  CONTRACT_RENEWAL_UPCOMING: contractRenewalUpcomingEventPayloadSchema,
  CLIENT_CONTRACT_CREATED: ClientContractEventPayloadSchema,
  CLIENT_CONTRACT_UPDATED: ClientContractEventPayloadSchema,
  CLIENT_CONTRACT_DELETED: ClientContractEventPayloadSchema,
  RECURRING_BILLING_RUN_STARTED: recurringBillingRunStartedEventPayloadSchema,
  RECURRING_BILLING_RUN_COMPLETED: recurringBillingRunCompletedEventPayloadSchema,
  RECURRING_BILLING_RUN_FAILED: recurringBillingRunFailedEventPayloadSchema,

  // CRM (domain expansion)
  CLIENT_CREATED: clientCreatedEventPayloadSchema,
  CLIENT_UPDATED: clientUpdatedEventPayloadSchema,
  CLIENT_STATUS_CHANGED: clientStatusChangedEventPayloadSchema,
  CLIENT_OWNER_ASSIGNED: clientOwnerAssignedEventPayloadSchema,
  CLIENT_MERGED: clientMergedEventPayloadSchema,
  CLIENT_ARCHIVED: clientArchivedEventPayloadSchema,
  CLIENT_DELETED: clientDeletedEventPayloadSchema,
  CONTACT_CREATED: contactCreatedEventPayloadSchema,
  CONTACT_UPDATED: contactUpdatedEventPayloadSchema,
  CONTACT_PRIMARY_SET: contactPrimarySetEventPayloadSchema,
  CONTACT_ARCHIVED: contactArchivedEventPayloadSchema,
  CONTACT_DELETED: contactDeletedEventPayloadSchema,
  CONTACT_MERGED: contactMergedEventPayloadSchema,
  INTERACTION_LOGGED: interactionLoggedEventPayloadSchema,
  INTERACTION_CREATED: InteractionEventPayloadSchema,
  INTERACTION_UPDATED: InteractionEventPayloadSchema,
  INTERACTION_DELETED: InteractionEventPayloadSchema,
  NOTE_CREATED: noteCreatedEventPayloadSchema,
  TAG_DEFINITION_CREATED: tagDefinitionCreatedEventPayloadSchema,
  TAG_DEFINITION_UPDATED: tagDefinitionUpdatedEventPayloadSchema,
  TAG_DEFINITION_DELETED: TagDefinitionDeletedPayloadSchema,
  TAG_APPLIED: tagAppliedEventPayloadSchema,
  TAG_REMOVED: tagRemovedEventPayloadSchema,
  BOARD_CREATED: BoardEventPayloadSchema,
  BOARD_UPDATED: BoardEventPayloadSchema,
  BOARD_DELETED: BoardEventPayloadSchema,
  CATEGORY_CREATED: CategoryEventPayloadSchema,
  CATEGORY_UPDATED: CategoryEventPayloadSchema,
  CATEGORY_DELETED: CategoryEventPayloadSchema,
  STATUS_CREATED: StatusEventPayloadSchema,
  STATUS_UPDATED: StatusEventPayloadSchema,
  STATUS_DELETED: StatusEventPayloadSchema,

  // Opportunities
  OPPORTUNITY_CREATED: opportunityCreatedEventPayloadSchema,
  OPPORTUNITY_STAGE_CHANGED: opportunityStageChangedEventPayloadSchema,
  OPPORTUNITY_STATUS_CHANGED: opportunityStatusChangedEventPayloadSchema,
  OPPORTUNITY_STALLED: opportunityStalledEventPayloadSchema,
  OPPORTUNITY_ESCALATED: opportunityEscalatedEventPayloadSchema,
  OPPORTUNITY_NEXT_ACTION_OVERDUE: opportunityNextActionOverdueEventPayloadSchema,
  OPPORTUNITY_SUGGESTION_CREATED: opportunitySuggestionCreatedEventPayloadSchema,

  // Users
  USER_CREATED: UserEventPayloadSchema,
  USER_UPDATED: UserEventPayloadSchema,
  USER_DELETED: UserEventPayloadSchema,
  USER_ROLES_UPDATED: UserEventPayloadSchema,

  // Documents (domain expansion)
  DOCUMENT_UPLOADED: documentUploadedEventPayloadSchema,
  DOCUMENT_UPDATED: documentUpdatedEventPayloadSchema,
  DOCUMENT_DELETED: documentDeletedEventPayloadSchema,
  DOCUMENT_ASSOCIATED: documentAssociatedEventPayloadSchema,
  DOCUMENT_DETACHED: documentDetachedEventPayloadSchema,
  DOCUMENT_GENERATED: documentGeneratedEventPayloadSchema,
  DOCUMENT_SIGNATURE_REQUESTED: documentSignatureRequestedEventPayloadSchema,
  DOCUMENT_SIGNED: documentSignedEventPayloadSchema,
  DOCUMENT_SIGNATURE_EXPIRED: documentSignatureExpiredEventPayloadSchema,
  KB_ARTICLE_CREATED: kbArticleEventPayloadSchema,
  KB_ARTICLE_UPDATED: kbArticleEventPayloadSchema,
  KB_ARTICLE_DELETED: kbArticleEventPayloadSchema,
  SERVICE_CATALOG_CREATED: ServiceCatalogEventPayloadSchema,
  SERVICE_CATALOG_UPDATED: ServiceCatalogEventPayloadSchema,
  SERVICE_CATALOG_DELETED: ServiceCatalogEventPayloadSchema,
  SERVICE_REQUEST_SUBMISSION_CREATED: ServiceRequestSubmissionEventPayloadSchema,
  SERVICE_REQUEST_SUBMISSION_UPDATED: ServiceRequestSubmissionEventPayloadSchema,
  SERVICE_REQUEST_SUBMISSION_DELETED: ServiceRequestSubmissionEventPayloadSchema,
  SERVICE_REQUEST_DEFINITION_CREATED: ServiceRequestDefinitionEventPayloadSchema,
  SERVICE_REQUEST_DEFINITION_UPDATED: ServiceRequestDefinitionEventPayloadSchema,
  SERVICE_REQUEST_DEFINITION_DELETED: ServiceRequestDefinitionEventPayloadSchema,
  WORKFLOW_TASK_CREATED: WorkflowTaskEventPayloadSchema,
  WORKFLOW_TASK_UPDATED: WorkflowTaskEventPayloadSchema,
  WORKFLOW_TASK_DELETED: WorkflowTaskEventPayloadSchema,
  WORKFLOW_TASK_ASSIGNMENT_CHANGED: WorkflowTaskEventPayloadSchema,

  // Email providers + inbound email (already present)
  INBOUND_EMAIL_RECEIVED: InboundEmailReceivedPayloadSchema,
  EMAIL_PROVIDER_CONNECTED: emailProviderConnectedEventPayloadSchema,
  EMAIL_PROVIDER_DISCONNECTED: emailProviderDisconnectedEventPayloadSchema,

  // Email (domain expansion)
  INBOUND_EMAIL_REPLY_RECEIVED: inboundEmailReplyReceivedEventPayloadSchema,
  OUTBOUND_EMAIL_QUEUED: outboundEmailQueuedEventPayloadSchema,
  OUTBOUND_EMAIL_SENT: outboundEmailSentEventPayloadSchema,
  OUTBOUND_EMAIL_FAILED: outboundEmailFailedEventPayloadSchema,
  EMAIL_DELIVERED: emailDeliveredEventPayloadSchema,
  EMAIL_BOUNCED: emailBouncedEventPayloadSchema,
  EMAIL_COMPLAINT_RECEIVED: emailComplaintReceivedEventPayloadSchema,
  EMAIL_UNSUBSCRIBED: emailUnsubscribedEventPayloadSchema,

  // Notifications (domain expansion)
  NOTIFICATION_SENT: notificationSentEventPayloadSchema,
  NOTIFICATION_DELIVERED: notificationDeliveredEventPayloadSchema,
  NOTIFICATION_FAILED: notificationFailedEventPayloadSchema,
  NOTIFICATION_READ: notificationReadEventPayloadSchema,

  // Surveys/CSAT (legacy + domain expansion)
  SURVEY_INVITATION_SENT: SurveyInvitationSentPayloadSchema,
  SURVEY_RESPONSE_SUBMITTED: SurveyResponseSubmittedPayloadSchema,
  SURVEY_NEGATIVE_RESPONSE: SurveyNegativeResponsePayloadSchema,
  SURVEY_SENT: surveySentEventPayloadSchema,
  SURVEY_RESPONSE_RECEIVED: surveyResponseReceivedEventPayloadSchema,
  SURVEY_REMINDER_SENT: surveyReminderSentEventPayloadSchema,
  SURVEY_EXPIRED: surveyExpiredEventPayloadSchema,
  CSAT_ALERT_TRIGGERED: csatAlertTriggeredEventPayloadSchema,

  // Integrations (existing)
  CUSTOM_EVENT: CustomEventPayloadSchema,
  ACCOUNTING_EXPORT_COMPLETED: AccountingExportEventPayloadSchema,
  ACCOUNTING_EXPORT_FAILED: AccountingExportEventPayloadSchema,
  CALENDAR_SYNC_STARTED: CalendarSyncEventPayloadSchema,
  CALENDAR_SYNC_COMPLETED: CalendarSyncEventPayloadSchema,
  CALENDAR_SYNC_FAILED: CalendarSyncEventPayloadSchema,
  CALENDAR_CONFLICT_DETECTED: CalendarConflictEventPayloadSchema,

  // Integrations (domain expansion)
  INTEGRATION_SYNC_STARTED: integrationSyncStartedEventPayloadSchema,
  INTEGRATION_SYNC_COMPLETED: integrationSyncCompletedEventPayloadSchema,
  INTEGRATION_SYNC_FAILED: integrationSyncFailedEventPayloadSchema,
  INTEGRATION_WEBHOOK_RECEIVED: integrationWebhookReceivedEventPayloadSchema,
  INTEGRATION_CONNECTED: integrationConnectedEventPayloadSchema,
  INTEGRATION_DISCONNECTED: integrationDisconnectedEventPayloadSchema,
  INTEGRATION_TOKEN_EXPIRING: integrationTokenExpiringEventPayloadSchema,
  INTEGRATION_TOKEN_REFRESH_FAILED: integrationTokenRefreshFailedEventPayloadSchema,
  EXTERNAL_MAPPING_CHANGED: externalMappingChangedEventPayloadSchema,

  // Messaging + mentions (legacy)
  MESSAGE_SENT: MessageSentPayloadSchema,
  USER_MENTIONED_IN_DOCUMENT: DocumentMentionPayloadSchema,

  // Assets + media (domain expansion)
  ASSET_CREATED: assetCreatedEventPayloadSchema,
  ASSET_UPDATED: assetUpdatedEventPayloadSchema,
  ASSET_DELETED: AssetDeletedPayloadSchema,
  ASSET_ASSIGNED: assetAssignedEventPayloadSchema,
  ASSET_UNASSIGNED: assetUnassignedEventPayloadSchema,
  ASSET_WARRANTY_EXPIRING: assetWarrantyExpiringEventPayloadSchema,
  FILE_UPLOADED: fileUploadedEventPayloadSchema,
  MEDIA_PROCESSING_SUCCEEDED: mediaProcessingSucceededEventPayloadSchema,
  MEDIA_PROCESSING_FAILED: mediaProcessingFailedEventPayloadSchema,

  // RMM Integration Events
  RMM_DEVICE_CREATED: RmmDeviceEventPayloadSchema,
  RMM_DEVICE_UPDATED: RmmDeviceEventPayloadSchema,
  RMM_DEVICE_DELETED: RmmDeviceEventPayloadSchema,
  RMM_DEVICE_ONLINE: RmmDeviceStatusEventPayloadSchema,
  RMM_DEVICE_OFFLINE: RmmDeviceStatusEventPayloadSchema,
  RMM_ALERT_TRIGGERED: RmmAlertEventPayloadSchema,
  RMM_ALERT_RESOLVED: RmmAlertEventPayloadSchema,
  RMM_SYNC_STARTED: RmmSyncEventPayloadSchema,
  RMM_SYNC_COMPLETED: RmmSyncEventPayloadSchema,
  RMM_SYNC_FAILED: RmmSyncEventPayloadSchema,
  RMM_WEBHOOK_RECEIVED: RmmWebhookEventPayloadSchema,

  // Inventory
  INVENTORY_STOCK_LOW: inventoryStockLowEventPayloadSchema,
  INVENTORY_PO_RECEIVED: inventoryPoReceivedEventPayloadSchema,
  INVENTORY_SO_FULFILLED: inventorySoFulfilledEventPayloadSchema,
  INVENTORY_RMA_CREATED: inventoryRmaCreatedEventPayloadSchema,
  INVENTORY_SALES_ORDER_CREATED: inventorySalesOrderSearchEventPayloadSchema,
  INVENTORY_SALES_ORDER_UPDATED: inventorySalesOrderSearchEventPayloadSchema,
  INVENTORY_SALES_ORDER_DELETED: inventorySalesOrderSearchEventPayloadSchema,
  INVENTORY_PURCHASE_ORDER_CREATED: inventoryPurchaseOrderSearchEventPayloadSchema,
  INVENTORY_PURCHASE_ORDER_UPDATED: inventoryPurchaseOrderSearchEventPayloadSchema,
  INVENTORY_PURCHASE_ORDER_DELETED: inventoryPurchaseOrderSearchEventPayloadSchema,
  INVENTORY_STOCK_UNIT_CREATED: inventoryStockUnitSearchEventPayloadSchema,
  INVENTORY_STOCK_UNIT_UPDATED: inventoryStockUnitSearchEventPayloadSchema,
  INVENTORY_STOCK_UNIT_DELETED: inventoryStockUnitSearchEventPayloadSchema,

  // Generic unknown type for custom events
  UNKNOWN: CustomEventPayloadSchema,
} as const;

const missingPayloadSchemas = EVENT_TYPES.filter((t) => !(t in EventPayloadSchemas));
if (missingPayloadSchemas.length > 0) {
  throw new Error(
    `[eventBusSchema] Missing payload schemas for event types: ${missingPayloadSchemas.join(', ')}`
  );
}

// Create specific event schemas by extending base schema with payload
export const EventSchemas = Object.entries(EventPayloadSchemas).reduce(
  (schemas, [eventType, payloadSchema]) => ({
    ...schemas,
    [eventType]: BaseEventSchema.extend({
      eventType: z.literal(eventType as EventType),
      payload: payloadSchema,
    }),
  }),
  {} as Record<EventType, z.ZodType>
);

// TypeScript types
export type BaseEvent = z.infer<typeof BaseEventSchema>;
export type TicketCreatedEvent = z.infer<typeof EventSchemas.TICKET_CREATED>;
export type TicketUpdatedEvent = z.infer<typeof EventSchemas.TICKET_UPDATED>;
export type TicketClosedEvent = z.infer<typeof EventSchemas.TICKET_CLOSED>;
export type TicketAutoCloseWarningEvent = z.infer<typeof EventSchemas.TICKET_AUTO_CLOSE_WARNING>;
export type MaintenanceJobRequestedEvent = z.infer<typeof EventSchemas.MAINTENANCE_JOB_REQUESTED>;
export type TicketDeletedEvent = z.infer<typeof EventSchemas.TICKET_DELETED>;
export type TicketAssignedEvent = z.infer<typeof EventSchemas.TICKET_ASSIGNED>;
export type TicketAdditionalAgentAssignedEvent = z.infer<typeof EventSchemas.TICKET_ADDITIONAL_AGENT_ASSIGNED>;
export type TicketCommentAddedEvent = z.infer<typeof EventSchemas.TICKET_COMMENT_ADDED>;
export type TicketCommentUpdatedEvent = z.infer<typeof EventSchemas.TICKET_COMMENT_UPDATED>;
export type TicketCommentDeletedEvent = z.infer<typeof EventSchemas.TICKET_COMMENT_DELETED>;
export type TicketResponseStateChangedEvent = z.infer<typeof EventSchemas.TICKET_RESPONSE_STATE_CHANGED>;
export type ProjectCreatedEvent = z.infer<typeof EventSchemas.PROJECT_CREATED>;
export type ProjectUpdatedEvent = z.infer<typeof EventSchemas.PROJECT_UPDATED>;
export type ProjectClosedEvent = z.infer<typeof EventSchemas.PROJECT_CLOSED>;
export type ProjectAssignedEvent = z.infer<typeof EventSchemas.PROJECT_ASSIGNED>;
export type ProjectTaskAssignedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_ASSIGNED>;
export type ProjectTaskAdditionalAgentAssignedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED>;
export type ProjectTaskUpdatedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_UPDATED>;
export type TaskCommentAddedEvent = z.infer<typeof EventSchemas.TASK_COMMENT_ADDED>;
export type TaskCommentUpdatedEvent = z.infer<typeof EventSchemas.TASK_COMMENT_UPDATED>;
export type TimeEntrySubmittedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_SUBMITTED>;
export type TimeEntryApprovedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_APPROVED>;
export type TimeEntryCreatedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_CREATED>;
export type TimeEntryUpdatedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_UPDATED>;
export type TimeEntryDeletedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_DELETED>;
export type TimeEntryChangesRequestedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_CHANGES_REQUESTED>;
export type TagDefinitionDeletedEvent = z.infer<typeof EventSchemas.TAG_DEFINITION_DELETED>;
export type InvoiceGeneratedEvent = z.infer<typeof EventSchemas.INVOICE_GENERATED>;
export type InvoiceFinalizedEvent = z.infer<typeof EventSchemas.INVOICE_FINALIZED>;
export type CreditExpiringEvent = z.infer<typeof EventSchemas.CREDIT_EXPIRING>;
export type CustomEvent = z.infer<typeof EventSchemas.CUSTOM_EVENT>;
export type InboundEmailReceivedEvent = z.infer<typeof EventSchemas.INBOUND_EMAIL_RECEIVED>;
export type AccountingExportCompletedEvent = z.infer<typeof EventSchemas.ACCOUNTING_EXPORT_COMPLETED>;
export type AccountingExportFailedEvent = z.infer<typeof EventSchemas.ACCOUNTING_EXPORT_FAILED>;
export type ScheduleEntryCreatedEvent = z.infer<typeof EventSchemas.SCHEDULE_ENTRY_CREATED>;
export type ScheduleEntryUpdatedEvent = z.infer<typeof EventSchemas.SCHEDULE_ENTRY_UPDATED>;
export type ScheduleEntryDeletedEvent = z.infer<typeof EventSchemas.SCHEDULE_ENTRY_DELETED>;
export type BoardCreatedEvent = z.infer<typeof EventSchemas.BOARD_CREATED>;
export type BoardUpdatedEvent = z.infer<typeof EventSchemas.BOARD_UPDATED>;
export type BoardDeletedEvent = z.infer<typeof EventSchemas.BOARD_DELETED>;
export type CategoryCreatedEvent = z.infer<typeof EventSchemas.CATEGORY_CREATED>;
export type CategoryUpdatedEvent = z.infer<typeof EventSchemas.CATEGORY_UPDATED>;
export type CategoryDeletedEvent = z.infer<typeof EventSchemas.CATEGORY_DELETED>;
export type StatusCreatedEvent = z.infer<typeof EventSchemas.STATUS_CREATED>;
export type StatusUpdatedEvent = z.infer<typeof EventSchemas.STATUS_UPDATED>;
export type StatusDeletedEvent = z.infer<typeof EventSchemas.STATUS_DELETED>;
export type CalendarSyncStartedEvent = z.infer<typeof EventSchemas.CALENDAR_SYNC_STARTED>;
export type CalendarSyncCompletedEvent = z.infer<typeof EventSchemas.CALENDAR_SYNC_COMPLETED>;
export type CalendarSyncFailedEvent = z.infer<typeof EventSchemas.CALENDAR_SYNC_FAILED>;
export type CalendarConflictDetectedEvent = z.infer<typeof EventSchemas.CALENDAR_CONFLICT_DETECTED>;
export type SurveyInvitationSentEvent = z.infer<typeof EventSchemas.SURVEY_INVITATION_SENT>;
export type SurveyResponseSubmittedEvent = z.infer<typeof EventSchemas.SURVEY_RESPONSE_SUBMITTED>;
export type SurveyNegativeResponseEvent = z.infer<typeof EventSchemas.SURVEY_NEGATIVE_RESPONSE>;
export type MessageSentEvent = z.infer<typeof EventSchemas.MESSAGE_SENT>;
export type UserMentionedInDocumentEvent = z.infer<typeof EventSchemas.USER_MENTIONED_IN_DOCUMENT>;
export type AppointmentRequestCreatedEvent = z.infer<typeof EventSchemas.APPOINTMENT_REQUEST_CREATED>;
export type AppointmentRequestApprovedEvent = z.infer<typeof EventSchemas.APPOINTMENT_REQUEST_APPROVED>;
export type AppointmentRequestDeclinedEvent = z.infer<typeof EventSchemas.APPOINTMENT_REQUEST_DECLINED>;
export type AppointmentRequestCancelledEvent = z.infer<typeof EventSchemas.APPOINTMENT_REQUEST_CANCELLED>;
// RMM Integration Event Types
export type RmmDeviceCreatedEvent = z.infer<typeof EventSchemas.RMM_DEVICE_CREATED>;
export type RmmDeviceUpdatedEvent = z.infer<typeof EventSchemas.RMM_DEVICE_UPDATED>;
export type RmmDeviceDeletedEvent = z.infer<typeof EventSchemas.RMM_DEVICE_DELETED>;
export type RmmDeviceOnlineEvent = z.infer<typeof EventSchemas.RMM_DEVICE_ONLINE>;
export type RmmDeviceOfflineEvent = z.infer<typeof EventSchemas.RMM_DEVICE_OFFLINE>;
export type RmmAlertTriggeredEvent = z.infer<typeof EventSchemas.RMM_ALERT_TRIGGERED>;
export type RmmAlertResolvedEvent = z.infer<typeof EventSchemas.RMM_ALERT_RESOLVED>;
export type RmmSyncStartedEvent = z.infer<typeof EventSchemas.RMM_SYNC_STARTED>;
export type RmmSyncCompletedEvent = z.infer<typeof EventSchemas.RMM_SYNC_COMPLETED>;
export type RmmSyncFailedEvent = z.infer<typeof EventSchemas.RMM_SYNC_FAILED>;
export type RmmWebhookReceivedEvent = z.infer<typeof EventSchemas.RMM_WEBHOOK_RECEIVED>;
export type InventoryStockLowEvent = z.infer<typeof EventSchemas.INVENTORY_STOCK_LOW>;
export type InventoryPoReceivedEvent = z.infer<typeof EventSchemas.INVENTORY_PO_RECEIVED>;
export type InventorySoFulfilledEvent = z.infer<typeof EventSchemas.INVENTORY_SO_FULFILLED>;
export type InventoryRmaCreatedEvent = z.infer<typeof EventSchemas.INVENTORY_RMA_CREATED>;
export type InventorySalesOrderCreatedEvent = z.infer<typeof EventSchemas.INVENTORY_SALES_ORDER_CREATED>;
export type InventorySalesOrderUpdatedEvent = z.infer<typeof EventSchemas.INVENTORY_SALES_ORDER_UPDATED>;
export type InventorySalesOrderDeletedEvent = z.infer<typeof EventSchemas.INVENTORY_SALES_ORDER_DELETED>;
export type InventoryPurchaseOrderCreatedEvent = z.infer<typeof EventSchemas.INVENTORY_PURCHASE_ORDER_CREATED>;
export type InventoryPurchaseOrderUpdatedEvent = z.infer<typeof EventSchemas.INVENTORY_PURCHASE_ORDER_UPDATED>;
export type InventoryPurchaseOrderDeletedEvent = z.infer<typeof EventSchemas.INVENTORY_PURCHASE_ORDER_DELETED>;
export type InventoryStockUnitCreatedEvent = z.infer<typeof EventSchemas.INVENTORY_STOCK_UNIT_CREATED>;
export type InventoryStockUnitUpdatedEvent = z.infer<typeof EventSchemas.INVENTORY_STOCK_UNIT_UPDATED>;
export type InventoryStockUnitDeletedEvent = z.infer<typeof EventSchemas.INVENTORY_STOCK_UNIT_DELETED>;

export type Event =
  {
    [K in keyof typeof EventSchemas]: z.infer<(typeof EventSchemas)[K]>;
  }[keyof typeof EventSchemas];

export type WorkflowPublishHooks = {
  executionId?: string;
  correlationKey?: string;
  eventName?: string;
  fromState?: string;
  toState?: string;
};

/**
 * Convert an event bus event to a workflow event
 * This ensures compatibility between the event bus and workflow systems
 */
export function convertToWorkflowEvent(event: Event, hooks?: WorkflowPublishHooks): any {
  return {
    event_id: event.id,
    execution_id: hooks?.executionId,
    workflow_correlation_key: hooks?.correlationKey,
    event_name: hooks?.eventName ?? event.payload?.eventName ?? event.eventType,
    event_type: event.eventType,
    tenant: event.payload?.tenantId ?? event.payload?.tenant ?? '',
    timestamp: event.timestamp,
    from_state: hooks?.fromState,
    to_state: hooks?.toState,
    user_id: event.payload?.actorUserId ?? event.payload?.userId,
    payload: event.payload
  };
}
