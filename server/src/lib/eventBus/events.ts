import { z } from 'zod';

// Define event types
export const EventTypeEnum = z.enum([
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_ASSIGNED',
  'TICKET_ADDITIONAL_AGENT_ASSIGNED',
  'TICKET_COMMENT_ADDED',
  'TICKET_DELETED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_CLOSED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
  'TIME_ENTRY_SUBMITTED',
  'TIME_ENTRY_APPROVED',
  'INVOICE_GENERATED',
  'INVOICE_FINALIZED',
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
  'SURVEY_INVITATION_SENT',
  'SURVEY_RESPONSE_SUBMITTED',
  'SURVEY_NEGATIVE_RESPONSE',
]);

export type EventType = z.infer<typeof EventTypeEnum>;

// Base payload schema with tenant information
export const BasePayloadSchema = z.object({
  tenantId: z.string().uuid(),
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
  userId: z.string().uuid(), // The user being assigned to the ticket
  assignedByUserId: z.string().uuid().optional(), // The user who performed the assignment
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
  assignedByUserId: z.string().uuid().optional(), // The user who performed the assignment
  additionalUsers: z.array(z.string().uuid()).optional(),
});

// Ticket additional agent event payload schema
export const TicketAdditionalAgentPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  primaryAgentId: z.string().uuid(),      // Existing primary agent
  additionalAgentId: z.string().uuid(),   // New additional agent
  assignedByUserId: z.string().uuid(),    // Who performed the action
});

// Project task additional agent event payload schema
export const ProjectTaskAdditionalAgentPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  primaryAgentId: z.string().uuid(),      // Existing primary agent
  additionalAgentId: z.string().uuid(),   // New additional agent
  assignedByUserId: z.string().uuid(),    // Who performed the action
});

// Document mention event payload schema
export const DocumentMentionPayloadSchema = BasePayloadSchema.extend({
  documentId: z.string().uuid(),
  documentName: z.string(),
  userId: z.string().uuid(), // User who updated the document
  content: z.string(), // Document content with mentions
  changes: z.record(z.unknown()).optional(),
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
  amount: z.number(),
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

// Message event payload schema
export const MessageEventPayloadSchema = BasePayloadSchema.extend({
  messageId: z.string().uuid(),
  senderId: z.string().uuid(),
  recipientId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  messagePreview: z.string(),
  senderName: z.string(),
});

// Appointment request event payload schema
export const AppointmentRequestEventPayloadSchema = BasePayloadSchema.extend({
  appointmentRequestId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  clientUserId: z.string().uuid().optional(), // The client portal user who created the request
  serviceId: z.string().uuid(),
  serviceName: z.string(),
  requestedDate: z.string(),
  requestedTime: z.string(),
  requestedDuration: z.number(),
  preferredAssignedUserId: z.string().uuid().optional(),
  isAuthenticated: z.boolean(),
  requesterName: z.string().optional(),
  requesterEmail: z.string(),
  requesterPhone: z.string().optional(),
  companyName: z.string().optional(),
  ticketId: z.string().uuid().optional(),
  description: z.string().optional(),
  // For approved events
  approvedByUserId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().optional(),
  scheduleEntryId: z.string().uuid().optional(),
  // For declined events
  declineReason: z.string().optional(),
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
  PROJECT_CREATED: ProjectEventPayloadSchema,
  PROJECT_UPDATED: ProjectEventPayloadSchema,
  PROJECT_CLOSED: ProjectClosedPayloadSchema,
  PROJECT_ASSIGNED: ProjectEventPayloadSchema,
  PROJECT_TASK_ASSIGNED: ProjectTaskEventPayloadSchema,
  PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED: ProjectTaskAdditionalAgentPayloadSchema,
  TIME_ENTRY_SUBMITTED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_APPROVED: TimeEntryEventPayloadSchema,
  INVOICE_GENERATED: InvoiceEventPayloadSchema,
  INVOICE_FINALIZED: InvoiceEventPayloadSchema,
  ACCOUNTING_EXPORT_COMPLETED: AccountingExportEventPayloadSchema,
  ACCOUNTING_EXPORT_FAILED: AccountingExportEventPayloadSchema,
  SCHEDULE_ENTRY_CREATED: ScheduleEntryEventPayloadSchema,
  SCHEDULE_ENTRY_UPDATED: ScheduleEntryEventPayloadSchema,
  SCHEDULE_ENTRY_DELETED: ScheduleEntryEventPayloadSchema,
  CALENDAR_SYNC_STARTED: CalendarSyncEventPayloadSchema,
  CALENDAR_SYNC_COMPLETED: CalendarSyncEventPayloadSchema,
  CALENDAR_SYNC_FAILED: CalendarSyncEventPayloadSchema,
  CALENDAR_CONFLICT_DETECTED: CalendarConflictEventPayloadSchema,
  SURVEY_INVITATION_SENT: SurveyInvitationSentPayloadSchema,
  SURVEY_RESPONSE_SUBMITTED: SurveyResponseSubmittedPayloadSchema,
  SURVEY_NEGATIVE_RESPONSE: SurveyNegativeResponsePayloadSchema,
  MESSAGE_SENT: MessageEventPayloadSchema,
  USER_MENTIONED_IN_DOCUMENT: DocumentMentionPayloadSchema,
  APPOINTMENT_REQUEST_CREATED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_APPROVED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_DECLINED: AppointmentRequestEventPayloadSchema,
  APPOINTMENT_REQUEST_CANCELLED: AppointmentRequestEventPayloadSchema,
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
export type TicketAdditionalAgentAssignedEvent = z.infer<typeof EventSchemas.TICKET_ADDITIONAL_AGENT_ASSIGNED>;
export type TicketCommentAddedEvent = z.infer<typeof EventSchemas.TICKET_COMMENT_ADDED>;
export type ProjectAssignedEvent = z.infer<typeof EventSchemas.PROJECT_ASSIGNED>;
export type ProjectTaskAssignedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_ASSIGNED>;
export type SurveyInvitationSentEvent = z.infer<typeof EventSchemas.SURVEY_INVITATION_SENT>;
export type SurveyResponseSubmittedEvent = z.infer<typeof EventSchemas.SURVEY_RESPONSE_SUBMITTED>;
export type SurveyNegativeResponseEvent = z.infer<typeof EventSchemas.SURVEY_NEGATIVE_RESPONSE>;
export type ProjectTaskAdditionalAgentAssignedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED>;
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
export type AppointmentRequestCreatedEvent = z.infer<typeof EventSchemas.APPOINTMENT_REQUEST_CREATED>;
export type AppointmentRequestApprovedEvent = z.infer<typeof EventSchemas.APPOINTMENT_REQUEST_APPROVED>;
export type AppointmentRequestDeclinedEvent = z.infer<typeof EventSchemas.APPOINTMENT_REQUEST_DECLINED>;
export type AppointmentRequestCancelledEvent = z.infer<typeof EventSchemas.APPOINTMENT_REQUEST_CANCELLED>;

export type Event =
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketClosedEvent
  | TicketAssignedEvent
  | TicketAdditionalAgentAssignedEvent
  | TicketCommentAddedEvent
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectClosedEvent
  | ProjectAssignedEvent
  | ProjectTaskAssignedEvent
  | ProjectTaskAdditionalAgentAssignedEvent
  | TimeEntrySubmittedEvent
  | TimeEntryApprovedEvent
  | InvoiceGeneratedEvent
  | InvoiceFinalizedEvent
  | TicketDeletedEvent
  | AccountingExportCompletedEvent
  | AccountingExportFailedEvent
  | ScheduleEntryCreatedEvent
  | ScheduleEntryUpdatedEvent
  | ScheduleEntryDeletedEvent
  | CalendarSyncStartedEvent
  | CalendarSyncCompletedEvent
  | CalendarSyncFailedEvent
  | CalendarConflictDetectedEvent
  | SurveyInvitationSentEvent
  | SurveyResponseSubmittedEvent
  | SurveyNegativeResponseEvent
  | UserMentionedInDocumentEvent
  | CalendarConflictDetectedEvent
  | SurveyInvitationSentEvent
  | SurveyResponseSubmittedEvent
  | SurveyNegativeResponseEvent
  | MessageSentEvent
  | AppointmentRequestCreatedEvent
  | AppointmentRequestApprovedEvent
  | AppointmentRequestDeclinedEvent
  | AppointmentRequestCancelledEvent;
