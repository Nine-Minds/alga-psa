import { z } from 'zod';

// Define event types
export const EventTypeEnum = z.enum([
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_ASSIGNED',
  'TICKET_ADDITIONAL_AGENT_ASSIGNED',
  'TICKET_COMMENT_ADDED',
  'TICKET_COMMENT_UPDATED',
  'TICKET_DELETED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_CLOSED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
  'TASK_COMMENT_ADDED',
  'TASK_COMMENT_UPDATED',
  'TIME_ENTRY_SUBMITTED',
  'TIME_ENTRY_APPROVED',
  'INVOICE_GENERATED',
  'INVOICE_FINALIZED',
  'CUSTOM_EVENT', // Added for test events
  'INBOUND_EMAIL_RECEIVED', // Inbound email processing
  'ACCOUNTING_EXPORT_COMPLETED',
  'ACCOUNTING_EXPORT_FAILED',
  'SCHEDULE_ENTRY_CREATED',
  'SCHEDULE_ENTRY_UPDATED',
  'SCHEDULE_ENTRY_DELETED',
  'CALENDAR_SYNC_STARTED',
  'CALENDAR_SYNC_COMPLETED',
  'CALENDAR_SYNC_FAILED',
  'CALENDAR_CONFLICT_DETECTED',
  'MESSAGE_SENT',
  'USER_MENTIONED_IN_DOCUMENT',
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
  // Alga Guard Events
  'GUARD_PII_SCAN_STARTED',
  'GUARD_PII_SCAN_COMPLETED',
  'GUARD_PII_HIGH_SEVERITY_FOUND',
  'GUARD_ASM_SCAN_STARTED',
  'GUARD_ASM_SCAN_COMPLETED',
  'GUARD_ASM_CRITICAL_CVE_FOUND',
  'GUARD_SCORE_UPDATED',
  'GUARD_SCORE_CRITICAL_THRESHOLD',
]);

export type EventType = z.infer<typeof EventTypeEnum>;

// Base payload schema with tenant information
export const BasePayloadSchema = z.object({
  tenantId: z.string(),
});

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
  userId: z.string().uuid(),
  changes: z.record(z.unknown()).optional(),
  comment: z.object({
    id: z.string().uuid(),
    content: z.string(),
    author: z.string(),
    isInternal: z.boolean().optional(),
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

// Project task event payload schema
export const ProjectTaskEventPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  assignedTo: z.string().uuid(),
  additionalUsers: z.array(z.string().uuid()).optional(),
});

// Project task additional agent event payload schema
export const ProjectTaskAdditionalAgentPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  primaryAgentId: z.string().uuid(),      // Existing primary agent
  additionalAgentId: z.string().uuid(),   // New additional agent
  assignedByUserId: z.string().uuid(),    // Who performed the action
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
  userId: z.string().uuid(),
  workItemId: z.string().uuid(),
  workItemType: z.enum(['TICKET', 'PROJECT_TASK']),
});

// Invoice event payload schema
export const InvoiceEventPayloadSchema = BasePayloadSchema.extend({
  invoiceId: z.string().uuid(),
  clientId: z.string().uuid(),
  userId: z.string().uuid(),
  totalAmount: z.string(), // Corrected type to string based on logs
  realmId: z.string().nullable().optional(), // For QBO integration
  eventName: z.string(), // Matches published 'eventName'
  status: z.string(), // Matches published 'status'
  invoiceNumber: z.string(), // Matches published 'invoiceNumber'
});

// Client event payload schema
export const ClientEventPayloadSchema = BasePayloadSchema.extend({
  clientId: z.string().uuid(),
  userId: z.string().uuid().optional(), // User might not always be available for system-triggered events
  changes: z.record(z.unknown()).optional(), // Details of what changed
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
    })).optional(),
    threadId: z.string().optional(),
    inReplyTo: z.string().optional(),
    references: z.array(z.string()).optional(),
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

// Document mention event payload schema
export const DocumentMentionPayloadSchema = BasePayloadSchema.extend({
  documentId: z.string().uuid(),
  documentName: z.string(),
  userId: z.string().uuid(), // User who updated the document
  content: z.string(), // Document content with mentions
  changes: z.record(z.unknown()).optional(),
});

// Message sent event payload schema
export const MessageSentPayloadSchema = BasePayloadSchema.extend({
  messageId: z.string().uuid().optional(),
  userId: z.string().uuid(),
  content: z.string().optional(),
  recipientId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
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

// Map event types to their payload schemas
export const EventPayloadSchemas = {
  TICKET_CREATED: TicketEventPayloadSchema,
  TICKET_UPDATED: TicketEventPayloadSchema,
  TICKET_CLOSED: TicketEventPayloadSchema,
  TICKET_DELETED: TicketEventPayloadSchema,
  TICKET_ASSIGNED: TicketEventPayloadSchema,
  TICKET_ADDITIONAL_AGENT_ASSIGNED: TicketAdditionalAgentPayloadSchema,
  TICKET_COMMENT_ADDED: TicketEventPayloadSchema,
  TICKET_COMMENT_UPDATED: TicketCommentUpdatedPayloadSchema,
  PROJECT_CREATED: ProjectEventPayloadSchema,
  PROJECT_UPDATED: ProjectEventPayloadSchema,
  PROJECT_CLOSED: ProjectClosedPayloadSchema,
  PROJECT_ASSIGNED: ProjectEventPayloadSchema,
  PROJECT_TASK_ASSIGNED: ProjectTaskEventPayloadSchema,
  PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED: ProjectTaskAdditionalAgentPayloadSchema,
  TASK_COMMENT_ADDED: TaskCommentAddedPayloadSchema,
  TASK_COMMENT_UPDATED: TaskCommentUpdatedPayloadSchema,
  TIME_ENTRY_SUBMITTED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_APPROVED: TimeEntryEventPayloadSchema,
  INVOICE_GENERATED: InvoiceEventPayloadSchema,
  INVOICE_FINALIZED: InvoiceEventPayloadSchema,
  CUSTOM_EVENT: CustomEventPayloadSchema,
  INBOUND_EMAIL_RECEIVED: InboundEmailEventPayloadSchema, // Inbound email processing
  ACCOUNTING_EXPORT_COMPLETED: AccountingExportEventPayloadSchema,
  ACCOUNTING_EXPORT_FAILED: AccountingExportEventPayloadSchema,
  SCHEDULE_ENTRY_CREATED: ScheduleEntryEventPayloadSchema,
  SCHEDULE_ENTRY_UPDATED: ScheduleEntryEventPayloadSchema,
  SCHEDULE_ENTRY_DELETED: ScheduleEntryEventPayloadSchema,
  CALENDAR_SYNC_STARTED: CalendarSyncEventPayloadSchema,
  CALENDAR_SYNC_COMPLETED: CalendarSyncEventPayloadSchema,
  CALENDAR_SYNC_FAILED: CalendarSyncEventPayloadSchema,
  CALENDAR_CONFLICT_DETECTED: CalendarConflictEventPayloadSchema,
  MESSAGE_SENT: MessageSentPayloadSchema,
  USER_MENTIONED_IN_DOCUMENT: DocumentMentionPayloadSchema,
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
} as const;

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
export type TicketDeletedEvent = z.infer<typeof EventSchemas.TICKET_DELETED>;
export type TicketAssignedEvent = z.infer<typeof EventSchemas.TICKET_ASSIGNED>;
export type TicketAdditionalAgentAssignedEvent = z.infer<typeof EventSchemas.TICKET_ADDITIONAL_AGENT_ASSIGNED>;
export type TicketCommentAddedEvent = z.infer<typeof EventSchemas.TICKET_COMMENT_ADDED>;
export type TicketCommentUpdatedEvent = z.infer<typeof EventSchemas.TICKET_COMMENT_UPDATED>;
export type ProjectCreatedEvent = z.infer<typeof EventSchemas.PROJECT_CREATED>;
export type ProjectUpdatedEvent = z.infer<typeof EventSchemas.PROJECT_UPDATED>;
export type ProjectClosedEvent = z.infer<typeof EventSchemas.PROJECT_CLOSED>;
export type ProjectAssignedEvent = z.infer<typeof EventSchemas.PROJECT_ASSIGNED>;
export type ProjectTaskAssignedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_ASSIGNED>;
export type ProjectTaskAdditionalAgentAssignedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED>;
export type TaskCommentAddedEvent = z.infer<typeof EventSchemas.TASK_COMMENT_ADDED>;
export type TaskCommentUpdatedEvent = z.infer<typeof EventSchemas.TASK_COMMENT_UPDATED>;
export type TimeEntrySubmittedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_SUBMITTED>;
export type TimeEntryApprovedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_APPROVED>;
export type InvoiceGeneratedEvent = z.infer<typeof EventSchemas.INVOICE_GENERATED>;
export type InvoiceFinalizedEvent = z.infer<typeof EventSchemas.INVOICE_FINALIZED>;
export type CustomEvent = z.infer<typeof EventSchemas.CUSTOM_EVENT>;
export type InboundEmailReceivedEvent = z.infer<typeof EventSchemas.INBOUND_EMAIL_RECEIVED>;
export type AccountingExportCompletedEvent = z.infer<typeof EventSchemas.ACCOUNTING_EXPORT_COMPLETED>;
export type AccountingExportFailedEvent = z.infer<typeof EventSchemas.ACCOUNTING_EXPORT_FAILED>;
export type ScheduleEntryCreatedEvent = z.infer<typeof EventSchemas.SCHEDULE_ENTRY_CREATED>;
export type ScheduleEntryUpdatedEvent = z.infer<typeof EventSchemas.SCHEDULE_ENTRY_UPDATED>;
export type ScheduleEntryDeletedEvent = z.infer<typeof EventSchemas.SCHEDULE_ENTRY_DELETED>;
export type CalendarSyncStartedEvent = z.infer<typeof EventSchemas.CALENDAR_SYNC_STARTED>;
export type CalendarSyncCompletedEvent = z.infer<typeof EventSchemas.CALENDAR_SYNC_COMPLETED>;
export type CalendarSyncFailedEvent = z.infer<typeof EventSchemas.CALENDAR_SYNC_FAILED>;
export type CalendarConflictDetectedEvent = z.infer<typeof EventSchemas.CALENDAR_CONFLICT_DETECTED>;
export type MessageSentEvent = z.infer<typeof EventSchemas.MESSAGE_SENT>;
export type UserMentionedInDocumentEvent = z.infer<typeof EventSchemas.USER_MENTIONED_IN_DOCUMENT>;
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

export type Event =
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketClosedEvent
  | TicketDeletedEvent
  | TicketAssignedEvent
  | TicketAdditionalAgentAssignedEvent
  | TicketCommentAddedEvent
  | TicketCommentUpdatedEvent
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectClosedEvent
  | ProjectAssignedEvent
  | ProjectTaskAssignedEvent
  | ProjectTaskAdditionalAgentAssignedEvent
  | TaskCommentAddedEvent
  | TaskCommentUpdatedEvent
  | TimeEntrySubmittedEvent
  | TimeEntryApprovedEvent
  | InvoiceGeneratedEvent
  | InvoiceFinalizedEvent
  | CustomEvent
  | InboundEmailReceivedEvent
  | AccountingExportCompletedEvent
  | AccountingExportFailedEvent
  | ScheduleEntryCreatedEvent
  | ScheduleEntryUpdatedEvent
  | ScheduleEntryDeletedEvent
  | CalendarSyncStartedEvent
  | CalendarSyncCompletedEvent
  | CalendarSyncFailedEvent
  | CalendarConflictDetectedEvent
  | MessageSentEvent
  | UserMentionedInDocumentEvent
  // RMM Integration Events
  | RmmDeviceCreatedEvent
  | RmmDeviceUpdatedEvent
  | RmmDeviceDeletedEvent
  | RmmDeviceOnlineEvent
  | RmmDeviceOfflineEvent
  | RmmAlertTriggeredEvent
  | RmmAlertResolvedEvent
  | RmmSyncStartedEvent
  | RmmSyncCompletedEvent
  | RmmSyncFailedEvent
  | RmmWebhookReceivedEvent;

/**
 * Convert an event bus event to a workflow event
 * This ensures compatibility between the event bus and workflow systems
 */
export function convertToWorkflowEvent(event: Event): any {
  return {
    event_id: event.id,
    // execution_id is now optional and should not be set here for new workflow triggers.
    // It will be generated by the workflow runtime when a new execution starts.
    event_name: event.payload?.eventName || event.eventType,
    event_type: event.eventType,
    tenant: event.payload?.tenantId || '',
    timestamp: event.timestamp,
    user_id: event.payload?.userId,
    payload: event.payload
  };
}
