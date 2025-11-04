import { z } from 'zod';

// Define event types
export const EventTypeEnum = z.enum([
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_ASSIGNED',
  'TICKET_COMMENT_ADDED',
  'TICKET_DELETED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_CLOSED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'TIME_ENTRY_SUBMITTED',
  'TIME_ENTRY_APPROVED',
  'INVOICE_GENERATED',
  'INVOICE_FINALIZED',
  'CUSTOM_EVENT', // Added for test events
  'INVOICE_CREATED', // QBO Invoice Created
  'INVOICE_UPDATED', // QBO Invoice Updated
  'CLIENT_CREATED', // QBO Client Created
  'CLIENT_UPDATED', // QBO Client Updated
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

// Map event types to their payload schemas
export const EventPayloadSchemas = {
  TICKET_CREATED: TicketEventPayloadSchema,
  TICKET_UPDATED: TicketEventPayloadSchema,
  TICKET_CLOSED: TicketEventPayloadSchema,
  TICKET_DELETED: TicketEventPayloadSchema,
  TICKET_ASSIGNED: TicketEventPayloadSchema,
  TICKET_COMMENT_ADDED: TicketEventPayloadSchema,
  PROJECT_CREATED: ProjectEventPayloadSchema,
  PROJECT_UPDATED: ProjectEventPayloadSchema,
  PROJECT_CLOSED: ProjectClosedPayloadSchema,
  PROJECT_ASSIGNED: ProjectEventPayloadSchema,
  PROJECT_TASK_ASSIGNED: ProjectTaskEventPayloadSchema,
  TIME_ENTRY_SUBMITTED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_APPROVED: TimeEntryEventPayloadSchema,
  INVOICE_GENERATED: InvoiceEventPayloadSchema,
  INVOICE_FINALIZED: InvoiceEventPayloadSchema,
  CUSTOM_EVENT: CustomEventPayloadSchema,
  INVOICE_CREATED: InvoiceEventPayloadSchema, // Use Invoice schema for QBO invoice events
  INVOICE_UPDATED: InvoiceEventPayloadSchema, // Use Invoice schema for QBO invoice events
  CLIENT_CREATED: ClientEventPayloadSchema, // Client creation event
  CLIENT_UPDATED: ClientEventPayloadSchema, // Client update event
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
export type ProjectCreatedEvent = z.infer<typeof EventSchemas.PROJECT_CREATED>;
export type ProjectUpdatedEvent = z.infer<typeof EventSchemas.PROJECT_UPDATED>;
export type ProjectClosedEvent = z.infer<typeof EventSchemas.PROJECT_CLOSED>;
export type TimeEntrySubmittedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_SUBMITTED>;
export type TimeEntryApprovedEvent = z.infer<typeof EventSchemas.TIME_ENTRY_APPROVED>;
export type InvoiceGeneratedEvent = z.infer<typeof EventSchemas.INVOICE_GENERATED>;
export type InvoiceFinalizedEvent = z.infer<typeof EventSchemas.INVOICE_FINALIZED>;
export type TicketAssignedEvent = z.infer<typeof EventSchemas.TICKET_ASSIGNED>;
export type TicketCommentAddedEvent = z.infer<typeof EventSchemas.TICKET_COMMENT_ADDED>;
export type ProjectAssignedEvent = z.infer<typeof EventSchemas.PROJECT_ASSIGNED>;
export type ProjectTaskAssignedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_ASSIGNED>;
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

export type Event =
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketClosedEvent
  | TicketAssignedEvent
  | TicketCommentAddedEvent
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectClosedEvent
  | ProjectAssignedEvent
  | ProjectTaskAssignedEvent
  | TimeEntrySubmittedEvent
  | TimeEntryApprovedEvent
  | InvoiceGeneratedEvent
  | InvoiceFinalizedEvent
  | TicketDeletedEvent
  | CustomEvent
  | InboundEmailReceivedEvent
  | AccountingExportCompletedEvent
  | AccountingExportFailedEvent
  | z.infer<typeof EventSchemas.INVOICE_CREATED> // QBO Invoice Created
  | z.infer<typeof EventSchemas.INVOICE_UPDATED> // QBO Invoice Updated
  | z.infer<typeof EventSchemas.CLIENT_CREATED> // QBO Client Created
  | z.infer<typeof EventSchemas.CLIENT_UPDATED> // QBO Client Updated
  | ScheduleEntryCreatedEvent
  | ScheduleEntryUpdatedEvent
  | ScheduleEntryDeletedEvent
  | CalendarSyncStartedEvent
  | CalendarSyncCompletedEvent
  | CalendarSyncFailedEvent
  | CalendarConflictDetectedEvent
  | MessageSentEvent
  | UserMentionedInDocumentEvent;

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
