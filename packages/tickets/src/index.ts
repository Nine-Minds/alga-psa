/**
 * @alga-psa/tickets
 *
 * Ticket management module for Alga PSA.
 * Provides ticket CRUD operations, status management, and helpdesk functionality.
 */

// Models
export { Ticket, Priority, Status } from './models';

// Re-export ticket types from @alga-psa/types
export type {
  ITicket,
  ITicketListItem,
  ITicketListFilters,
  IPriority,
  IStandardPriority,
  ITicketStatus,
  ITicketCategory,
  IAgentSchedule,
  ITicketWithDetails,
  TicketResponseState,
  // Status types (shared)
  IStatus,
  IStandardStatus,
  StatusItemType,
} from '@alga-psa/types';

// Note: This module contains:
// - Ticket CRUD operations (Ticket model - migrated)
// - Status workflow management
// - Priority and SLA handling
// - Ticket comments and interactions
// - 19 ticket components (pending migration)
