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
  'TICKET_RESPONSE_STATE_CHANGED',
  'TICKET_STATUS_CHANGED',
  'TICKET_PRIORITY_CHANGED',
  'TICKET_UNASSIGNED',
  'TICKET_REOPENED',
  'TICKET_ESCALATED',
  'TICKET_QUEUE_CHANGED',
  'TICKET_MESSAGE_ADDED',
  'TICKET_CUSTOMER_REPLIED',
  'TICKET_INTERNAL_NOTE_ADDED',
  'TICKET_SLA_STAGE_ENTERED',
  'TICKET_SLA_STAGE_MET',
  'TICKET_SLA_STAGE_BREACHED',
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
  'CUSTOM_EVENT',
  'INBOUND_EMAIL_RECEIVED',
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
  'APPOINTMENT_REQUEST_CREATED',
  'APPOINTMENT_REQUEST_APPROVED',
  'APPOINTMENT_REQUEST_DECLINED',
  'APPOINTMENT_REQUEST_CANCELLED',
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
]);

export type EventType = z.infer<typeof EventTypeEnum>;

// Base payload schema with tenant information
export const BasePayloadSchema = z.object({
  tenantId: z.string(),
  occurredAt: z.string().optional(),
  actorType: z.enum(['USER', 'CONTACT', 'SYSTEM']).optional(),
  actorUserId: z.string().uuid().optional(),
  actorContactId: z.string().uuid().optional(),
  idempotencyKey: z.string().optional(),
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
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
  comment: z.object({
    id: z.string().uuid(),
    content: z.string(),
    author: z.string(),
    isInternal: z.boolean().optional(),
  }).optional(),
});

export const TicketResponseStateChangedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  previousResponseState: z.string().optional(),
  newResponseState: z.string().optional(),
});

export const TicketStatusChangedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  previousStatusId: z.string().min(1),
  newStatusId: z.string().min(1),
  changedAt: z.string().optional(),
});

export const TicketPriorityChangedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  previousPriorityId: z.string().min(1),
  newPriorityId: z.string().min(1),
  changedAt: z.string().optional(),
});

export const TicketUnassignedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  previousAssigneeId: z.string().uuid(),
  previousAssigneeType: z.enum(['user', 'team']),
  newAssigneeId: z.string().uuid().optional(),
  newAssigneeType: z.enum(['user', 'team']).optional(),
  unassignedAt: z.string().optional(),
});

export const TicketReopenedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  previousStatusId: z.string().min(1),
  newStatusId: z.string().min(1),
  reopenedAt: z.string().optional(),
});

export const TicketEscalatedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  fromQueueId: z.string().uuid().optional(),
  toQueueId: z.string().uuid().optional(),
  escalatedAt: z.string().optional(),
});

export const TicketQueueChangedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  previousBoardId: z.string().min(1),
  newBoardId: z.string().min(1),
  changedAt: z.string().optional(),
});

export const TicketMessageAddedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  messageId: z.string().min(1),
  visibility: z.enum(['public', 'internal']),
  authorId: z.string().min(1),
  authorType: z.enum(['user', 'contact']),
  channel: z.enum(['email', 'portal', 'ui', 'api']),
  createdAt: z.string().optional(),
  attachmentsCount: z.number().int().nonnegative().optional(),
});

export const TicketCustomerRepliedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  messageId: z.string().min(1),
  contactId: z.string().uuid(),
  channel: z.enum(['email', 'portal', 'ui', 'api']),
  receivedAt: z.string().optional(),
  attachmentsCount: z.number().int().nonnegative().optional(),
});

export const TicketInternalNoteAddedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  noteId: z.string().min(1),
  createdAt: z.string().optional(),
});

export const TicketSlaStageEnteredPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  slaPolicyId: z.string().min(1),
  stage: z.literal('resolution'),
  enteredAt: z.string().optional(),
  targetAt: z.string().optional(),
});

export const TicketSlaStageMetPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  slaPolicyId: z.string().min(1),
  stage: z.literal('resolution'),
  metAt: z.string().optional(),
  targetAt: z.string().optional(),
});

export const TicketSlaStageBreachedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  slaPolicyId: z.string().min(1),
  stage: z.literal('resolution'),
  breachedAt: z.string().optional(),
  targetAt: z.string().optional(),
  overdueBySeconds: z.number().int().nonnegative().optional(),
});

// Ticket additional agent event payload schema
export const TicketAdditionalAgentPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  primaryAgentId: z.string().uuid(),
  additionalAgentId: z.string().uuid(),
  assignedByUserId: z.string().uuid(),
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
  primaryAgentId: z.string().uuid(),
  additionalAgentId: z.string().uuid(),
  assignedByUserId: z.string().uuid(),
});

// Task comment event payload schemas
export const TaskCommentAddedPayloadSchema = BasePayloadSchema.extend({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  taskCommentId: z.string().uuid(),
  taskName: z.string(),
  commentContent: z.string(),
  isUpdate: z.boolean().optional(),
});

export const TaskCommentUpdatedPayloadSchema = BasePayloadSchema.extend({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  taskCommentId: z.string().uuid(),
  taskName: z.string(),
  oldCommentContent: z.string(),
  newCommentContent: z.string(),
  isUpdate: z.boolean().optional(),
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
  totalAmount: z.string(),
  realmId: z.string().nullable().optional(),
  eventName: z.string(),
  status: z.string(),
  invoiceNumber: z.string(),
});

// Client event payload schema
export const ClientEventPayloadSchema = BasePayloadSchema.extend({
  clientId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  changes: z.record(z.unknown()).optional(),
});

// Custom event payload schema for test events
export const CustomEventPayloadSchema = BasePayloadSchema.extend({
  userId: z.string().optional(),
  eventName: z.string().optional(),
}).catchall(z.unknown());

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
  error: z.object({
    message: z.string(),
    status: z.string().optional(),
    code: z.string().optional(),
  }).optional(),
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
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }).optional(),
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
  userId: z.string().uuid(),
  content: z.string(),
  // Fields for document updates (comparing old vs new content for mention detection)
  oldContent: z.unknown().optional(),
  newContent: z.string().optional(),
  isUpdate: z.boolean().optional(),
  changes: z.record(z.unknown()).optional(),
});

export const AppointmentRequestEventPayloadSchema = BasePayloadSchema.extend({
  requestId: z.string().uuid(),
  ticketId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
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
  provider: z.string(),
  assetId: z.string().uuid().optional(),
  externalDeviceId: z.string(),
  externalOrganizationId: z.string().optional(),
  deviceName: z.string().optional(),
  deviceType: z.string().optional(),
  changes: z.record(z.unknown()).optional(),
});

// RMM Device status event payload schema
export const RmmDeviceStatusEventPayloadSchema = RmmDeviceEventPayloadSchema.extend({
  previousStatus: z.string().optional(),
  currentStatus: z.string(),
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
  severity: z.string(),
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
  webhookEventType: z.string(),
  externalDeviceId: z.string().optional(),
  assetId: z.string().uuid().optional(),
  rawPayload: z.record(z.unknown()),
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
  TICKET_RESPONSE_STATE_CHANGED: TicketResponseStateChangedPayloadSchema,
  TICKET_STATUS_CHANGED: TicketStatusChangedPayloadSchema,
  TICKET_PRIORITY_CHANGED: TicketPriorityChangedPayloadSchema,
  TICKET_UNASSIGNED: TicketUnassignedPayloadSchema,
  TICKET_REOPENED: TicketReopenedPayloadSchema,
  TICKET_ESCALATED: TicketEscalatedPayloadSchema,
  TICKET_QUEUE_CHANGED: TicketQueueChangedPayloadSchema,
  TICKET_MESSAGE_ADDED: TicketMessageAddedPayloadSchema,
  TICKET_CUSTOMER_REPLIED: TicketCustomerRepliedPayloadSchema,
  TICKET_INTERNAL_NOTE_ADDED: TicketInternalNoteAddedPayloadSchema,
  TICKET_SLA_STAGE_ENTERED: TicketSlaStageEnteredPayloadSchema,
  TICKET_SLA_STAGE_MET: TicketSlaStageMetPayloadSchema,
  TICKET_SLA_STAGE_BREACHED: TicketSlaStageBreachedPayloadSchema,
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
  INBOUND_EMAIL_RECEIVED: InboundEmailEventPayloadSchema,
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
  APPOINTMENT_REQUEST_CREATED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_APPROVED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_DECLINED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_CANCELLED: AppointmentRequestEventPayloadSchema,
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
export type TicketResponseStateChangedEvent = z.infer<typeof EventSchemas.TICKET_RESPONSE_STATE_CHANGED>;
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
  {
    [K in keyof typeof EventSchemas]: z.infer<(typeof EventSchemas)[K]>;
  }[keyof typeof EventSchemas];

export type WorkflowPublishHooks = {
  executionId?: string;
  eventName?: string;
  fromState?: string;
  toState?: string;
};

/**
 * Convert an event bus event to a workflow event
 */
export function convertToWorkflowEvent(event: Event, hooks?: WorkflowPublishHooks): any {
  const payload = (event as any).payload as Record<string, unknown> | undefined;
  return {
    event_id: event.id,
    execution_id: hooks?.executionId,
    event_name: hooks?.eventName ?? (payload as any)?.eventName ?? event.eventType,
    event_type: event.eventType,
    tenant: (payload as any)?.tenantId || '',
    timestamp: event.timestamp,
    from_state: hooks?.fromState,
    to_state: hooks?.toState,
    user_id: (payload as any)?.actorUserId ?? (payload as any)?.userId,
    payload
  };
}
