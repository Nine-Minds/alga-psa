/**
 * @alga-psa/tickets - Actions
 *
 * Server actions for ticket operations.
 */

export * from './optimizedTicketActions';
// Re-export ticketActions but exclude getTicketsForList (conflicts with optimizedTicketActions)
export {
  createTicketFromAsset,
  addTicket,
  fetchTicketAttributes,
  updateTicket,
  getTickets,
  // getTicketsForList excluded - conflicts with optimizedTicketActions
  addTicketComment,
  deleteTicket,
  deleteTickets,
  moveTicketsToBoard,
  getScheduledHoursForTicket,
  getTicketById,
  registerSlaCancellation
} from './ticketActions';
// NB: registerItilSlaConfiguration is intentionally NOT re-exported here. It is
// an internal DI hook (not a server action) defined in services/itilStandardsService,
// which imports @alga-psa/db. Re-exporting it from this actions barrel dragged the
// server db/knex chain into every client component that imports the barrel (e.g.
// BoardsSettings -> the whole client-portal ticket UI). Its only consumer imports
// it directly from '@alga-psa/tickets/services/itilStandardsService'.
export * from './ticketBundleActions';
export * from './ticketBundleUtils';
export * from './ticketDisplaySettings';
export * from './ticketFormActions';
export * from './clientLookupActions';
export * from './board-actions';
export * from './comment-actions';
export * from './ticket-number-actions';
export * from './ticketCategoryActions';
export * from './ticketResourceActions';
export * from './teamAssignmentActions';
export * from './materialCatalogActions';
export * from './ticketExportActions';
export * from './ticketImportActions';
export * from './ticketActivityActions';
export * from './close-rules';
export * from './checklists';
