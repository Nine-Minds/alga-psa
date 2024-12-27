import { z } from 'zod';

// Define event types
export const EventTypeEnum = z.enum([
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_DELETED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_CLOSED',
  'TIME_ENTRY_SUBMITTED',
  'TIME_ENTRY_APPROVED',
  'INVOICE_GENERATED',
  'INVOICE_FINALIZED',
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
  userId: z.string().uuid(),
  changes: z.record(z.unknown()).optional(),
});

// Project event payload schema
export const ProjectEventPayloadSchema = BasePayloadSchema.extend({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
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
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number(),
});

// Map event types to their payload schemas
export const EventPayloadSchemas = {
  TICKET_CREATED: TicketEventPayloadSchema,
  TICKET_UPDATED: TicketEventPayloadSchema,
  TICKET_CLOSED: TicketEventPayloadSchema,
  TICKET_DELETED: TicketEventPayloadSchema,
  PROJECT_CREATED: ProjectEventPayloadSchema,
  PROJECT_UPDATED: ProjectEventPayloadSchema,
  PROJECT_CLOSED: ProjectEventPayloadSchema,
  TIME_ENTRY_SUBMITTED: TimeEntryEventPayloadSchema,
  TIME_ENTRY_APPROVED: TimeEntryEventPayloadSchema,
  INVOICE_GENERATED: InvoiceEventPayloadSchema,
  INVOICE_FINALIZED: InvoiceEventPayloadSchema,
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

// Union type of all events
export type Event =
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketClosedEvent
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectClosedEvent
  | TimeEntrySubmittedEvent
  | TimeEntryApprovedEvent
  | InvoiceGeneratedEvent
  | InvoiceFinalizedEvent
  | TicketDeletedEvent;
