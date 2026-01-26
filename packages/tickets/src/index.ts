/**
 * @alga-psa/tickets
 *
 * Ticket management module for Alga PSA.
 * Provides ticket CRUD operations, status management, and helpdesk functionality.
 *
 * Main entry point exports buildable lib/models code only.
 * For runtime code, use:
 * - '@alga-psa/tickets/actions' for server actions
 * - '@alga-psa/tickets/components' for React components
 */

// Models
export { default as Ticket } from './models/ticket';
export { default as Priority } from './models/priority';
export { default as Status } from './models/status';
export { default as Board } from './models/board';
export { default as Comment } from './models/comment';

// Schemas
export * from './schemas/ticket.schema';

// Lib utilities
export * from './lib/itilUtils';
export * from './lib/workflowTicketTransitionEvents';
export * from './lib/workflowTicketCommunicationEvents';
export * from './lib/workflowTicketSlaStageEvents';

// Adapters
export { TicketModelEventPublisher } from './lib/adapters/TicketModelEventPublisher';
export { TicketModelAnalyticsTracker } from './lib/adapters/TicketModelAnalyticsTracker';

// Services
export { ItilStandardsService } from './services/itilStandardsService';

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
