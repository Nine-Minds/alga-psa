// Moved to @alga-psa/authorization so layers below tickets (inventory) can use it. Kept as a re-export so
// existing importers keep working.
export {
  authorizeTicketRecordAccess,
  authorizeTicketRecordAccessConcealed,
  createTicketAuthorizationContext,
} from '@alga-psa/authorization/ticketRecordAuthorization';
export type { TicketRecordRow } from '@alga-psa/authorization/ticketRecordAuthorization';
