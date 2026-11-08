// Moved to @alga-psa/authorization so layers below tickets (inventory) can use it. Kept as a re-export so
// existing importers keep working.
export {
  authorizeTicketRecordAccess,
  authorizeTicketRecordAccessConcealed,
  createTicketAuthorizationContext,
  runAuthorizedTicketWatcherWrite,
  TicketWatcherPermissionError,
  TicketWatcherTicketNotFoundError,
} from '@alga-psa/authorization/ticketRecordAuthorization';
export type {
  TicketRecordRow,
  TicketWatcherWritePrincipal,
} from '@alga-psa/authorization/ticketRecordAuthorization';
