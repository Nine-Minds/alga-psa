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
  // RMM Integration events
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
  // Generic unknown type for custom events
  'UNKNOWN',
  // Alga Guard events
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
    authorType: z.enum(['internal', 'client', 'unknown']).optional(), // F039: Added author_type to event payload
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
  oldContent: z.string().optional(), // Old content for smart mention detection
  newContent: z.string().optional(), // New content for smart mention detection
  isUpdate: z.boolean().optional(), // Whether this is an update or new content
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

// Ticket response state change event payload schema
export const TicketResponseStateChangedPayloadSchema = BasePayloadSchema.extend({
  ticketId: z.string().uuid(),
  userId: z.string().uuid().nullable(), // May be null for client-triggered changes
  previousState: z.enum(['awaiting_client', 'awaiting_internal']).nullable(),
  newState: z.enum(['awaiting_client', 'awaiting_internal']).nullable(),
  trigger: z.enum(['comment', 'manual', 'close']),
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

// ============================================================================
// ALGA GUARD EVENT PAYLOAD SCHEMAS
// ============================================================================

// Guard PII scan event payload schema
export const GuardPiiScanEventPayloadSchema = BasePayloadSchema.extend({
  jobId: z.string().uuid(),
  profileId: z.string().uuid(),
  profileName: z.string().optional(),
  companyId: z.string().uuid().optional(),
  companyName: z.string().optional(),
});

// Guard PII scan completed event payload schema (extends base)
export const GuardPiiScanCompletedPayloadSchema = GuardPiiScanEventPayloadSchema.extend({
  totalFilesScanned: z.number(),
  totalMatches: z.number(),
  highSeverityCount: z.number().optional(),
  duration: z.number().optional(), // Duration in seconds
});

// Guard PII high severity found event payload schema
export const GuardPiiHighSeverityFoundPayloadSchema = BasePayloadSchema.extend({
  jobId: z.string().uuid(),
  profileId: z.string().uuid(),
  profileName: z.string().optional(),
  companyId: z.string().uuid().optional(),
  companyName: z.string().optional(),
  piiType: z.string(), // Type of high severity PII found
  count: z.number(), // Number of matches found
  severity: z.enum(['high', 'critical']),
  filePath: z.string().optional(), // Sample file path (may be redacted)
});

// Guard ASM scan event payload schema
export const GuardAsmScanEventPayloadSchema = BasePayloadSchema.extend({
  jobId: z.string().uuid(),
  domainId: z.string().uuid(),
  domainName: z.string().optional(),
  companyId: z.string().uuid().optional(),
  companyName: z.string().optional(),
});

// Guard ASM scan completed event payload schema
export const GuardAsmScanCompletedPayloadSchema = GuardAsmScanEventPayloadSchema.extend({
  totalFindings: z.number(),
  criticalCveCount: z.number().optional(),
  highCveCount: z.number().optional(),
  openPortsCount: z.number().optional(),
  duration: z.number().optional(), // Duration in seconds
});

// Guard ASM critical CVE found event payload schema
export const GuardAsmCriticalCveFoundPayloadSchema = BasePayloadSchema.extend({
  jobId: z.string().uuid(),
  domainId: z.string().uuid(),
  domainName: z.string().optional(),
  companyId: z.string().uuid().optional(),
  companyName: z.string().optional(),
  cveId: z.string(), // CVE identifier (e.g., CVE-2021-44228)
  cvssScore: z.number().optional(), // CVSS score 0-10
  severity: z.enum(['critical', 'high']),
  affectedAsset: z.string().optional(), // IP or hostname affected
  description: z.string().optional(),
});

// Guard security score updated event payload schema
export const GuardScoreUpdatedPayloadSchema = BasePayloadSchema.extend({
  companyId: z.string().uuid(),
  companyName: z.string().optional(),
  previousScore: z.number().optional(),
  newScore: z.number(),
  previousRiskLevel: z.enum(['critical', 'high', 'moderate', 'low']).optional(),
  newRiskLevel: z.enum(['critical', 'high', 'moderate', 'low']),
  triggeredBy: z.enum(['pii_scan', 'asm_scan', 'manual', 'scheduled']),
  triggeredJobId: z.string().uuid().optional(),
});

// Guard score critical threshold event payload schema
export const GuardScoreCriticalThresholdPayloadSchema = BasePayloadSchema.extend({
  companyId: z.string().uuid(),
  companyName: z.string().optional(),
  score: z.number(),
  riskLevel: z.literal('critical'),
  previousScore: z.number().optional(),
  previousRiskLevel: z.enum(['critical', 'high', 'moderate', 'low']).optional(),
  topIssues: z.array(z.object({
    type: z.string(),
    count: z.number(),
    penalty: z.number(),
  })).optional(),
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
  // Alga Guard events
  GUARD_PII_SCAN_STARTED: GuardPiiScanEventPayloadSchema,
  GUARD_PII_SCAN_COMPLETED: GuardPiiScanCompletedPayloadSchema,
  GUARD_PII_HIGH_SEVERITY_FOUND: GuardPiiHighSeverityFoundPayloadSchema,
  GUARD_ASM_SCAN_STARTED: GuardAsmScanEventPayloadSchema,
  GUARD_ASM_SCAN_COMPLETED: GuardAsmScanCompletedPayloadSchema,
  GUARD_ASM_CRITICAL_CVE_FOUND: GuardAsmCriticalCveFoundPayloadSchema,
  GUARD_SCORE_UPDATED: GuardScoreUpdatedPayloadSchema,
  GUARD_SCORE_CRITICAL_THRESHOLD: GuardScoreCriticalThresholdPayloadSchema,
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
export type TicketCommentUpdatedEvent = z.infer<typeof EventSchemas.TICKET_COMMENT_UPDATED>;
export type TicketResponseStateChangedEvent = z.infer<typeof EventSchemas.TICKET_RESPONSE_STATE_CHANGED>;
export type ProjectAssignedEvent = z.infer<typeof EventSchemas.PROJECT_ASSIGNED>;
export type ProjectTaskAssignedEvent = z.infer<typeof EventSchemas.PROJECT_TASK_ASSIGNED>;
export type TaskCommentAddedEvent = z.infer<typeof EventSchemas.TASK_COMMENT_ADDED>;
export type TaskCommentUpdatedEvent = z.infer<typeof EventSchemas.TASK_COMMENT_UPDATED>;
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
// Alga Guard event types
export type GuardPiiScanStartedEvent = z.infer<typeof EventSchemas.GUARD_PII_SCAN_STARTED>;
export type GuardPiiScanCompletedEvent = z.infer<typeof EventSchemas.GUARD_PII_SCAN_COMPLETED>;
export type GuardPiiHighSeverityFoundEvent = z.infer<typeof EventSchemas.GUARD_PII_HIGH_SEVERITY_FOUND>;
export type GuardAsmScanStartedEvent = z.infer<typeof EventSchemas.GUARD_ASM_SCAN_STARTED>;
export type GuardAsmScanCompletedEvent = z.infer<typeof EventSchemas.GUARD_ASM_SCAN_COMPLETED>;
export type GuardAsmCriticalCveFoundEvent = z.infer<typeof EventSchemas.GUARD_ASM_CRITICAL_CVE_FOUND>;
export type GuardScoreUpdatedEvent = z.infer<typeof EventSchemas.GUARD_SCORE_UPDATED>;
export type GuardScoreCriticalThresholdEvent = z.infer<typeof EventSchemas.GUARD_SCORE_CRITICAL_THRESHOLD>;

export type Event =
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketClosedEvent
  | TicketAssignedEvent
  | TicketAdditionalAgentAssignedEvent
  | TicketCommentAddedEvent
  | TicketCommentUpdatedEvent
  | TicketResponseStateChangedEvent
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
  | AppointmentRequestCancelledEvent
  // Alga Guard events
  | GuardPiiScanStartedEvent
  | GuardPiiScanCompletedEvent
  | GuardPiiHighSeverityFoundEvent
  | GuardAsmScanStartedEvent
  | GuardAsmScanCompletedEvent
  | GuardAsmCriticalCveFoundEvent
  | GuardScoreUpdatedEvent
  | GuardScoreCriticalThresholdEvent;
