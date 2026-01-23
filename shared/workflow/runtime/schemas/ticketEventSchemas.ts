import { z } from 'zod';

/**
 * Ticket event payloads for workflow runtime v2 simulation and validation.
 *
 * Notes:
 * - Tenant is inferred from the authenticated session in UI-driven simulations; it is not part of the payload shape.
 * - These are intentionally higher-level and stable; they can be expanded/versioned as needed.
 */

const ticketIdSchema = z.string().uuid().describe('Ticket ID');
const userIdSchema = z.string().uuid().describe('User ID');

export const ticketCreatedEventPayloadSchema = z.object({
  ticketId: ticketIdSchema,
  createdByUserId: userIdSchema.optional().describe('User who created the ticket'),
  createdAt: z.string().optional().describe('Created timestamp (ISO 8601)'),
  changes: z.record(z.unknown()).optional().describe('Optional change summary')
}).describe('Payload for TICKET_CREATED (tenant inferred from session)');

export type TicketCreatedEventPayload = z.infer<typeof ticketCreatedEventPayloadSchema>;

export const ticketAssignedEventPayloadSchema = z.object({
  ticketId: ticketIdSchema,
  assignedToUserId: userIdSchema.optional().describe('User assigned to the ticket'),
  assignedByUserId: userIdSchema.optional().describe('User who performed the assignment'),
  assignedAt: z.string().optional().describe('Assigned timestamp (ISO 8601)'),
  changes: z.record(z.unknown()).optional().describe('Optional change summary')
}).describe('Payload for TICKET_ASSIGNED (tenant inferred from session)');

export type TicketAssignedEventPayload = z.infer<typeof ticketAssignedEventPayloadSchema>;

export const ticketClosedEventPayloadSchema = z.object({
  ticketId: ticketIdSchema,
  closedByUserId: userIdSchema.optional().describe('User who closed the ticket'),
  closedAt: z.string().optional().describe('Closed timestamp (ISO 8601)'),
  reason: z.string().optional().describe('Optional close reason'),
  changes: z.record(z.unknown()).optional().describe('Optional change summary')
}).describe('Payload for TICKET_CLOSED (tenant inferred from session)');

export type TicketClosedEventPayload = z.infer<typeof ticketClosedEventPayloadSchema>;

