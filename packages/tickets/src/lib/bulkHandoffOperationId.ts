/**
 * Server only (node:crypto): imported by the bulk handoff action, never by a client component.
 * See ./bulkHandoff for the pure parts the dialog also uses.
 */
import { createHash } from 'node:crypto';
import type { TicketHandoffDirection } from './ticketResponsibility';

// LEVERAGE: pattern derived-operation-id — same sha256-to-UUIDv5-shape derivation as arrangementReturnOperationId in @alga-psa/co-managed seatTicketHandoff
export function bulkHandoffOperationId(submissionId: string, direction: TicketHandoffDirection, ticketId: string): string {
  const hex = createHash('sha256')
    .update(`ticket-bulk-handoff:${submissionId.toLowerCase()}:${direction}:${ticketId.toLowerCase()}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

