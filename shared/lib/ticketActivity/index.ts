/**
 * Public surface of the ticket activity feature.
 * See ee/docs/plans/2026-05-25-ticket-audit-logs/PRD.md.
 *
 * NOTE: Explicit named exports (not `export * from`) — the RSC/Turbopack
 * bundler does not always follow star re-exports through the published
 * package entry, so listing each binding keeps `@alga-psa/shared/lib/
 * ticketActivity` callable from server components.
 */

export {
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_SOURCE,
  CURATED_TICKET_FIELDS,
} from './types';
export type {
  TicketActivityEvent,
  TicketActivityEntity,
  TicketActivityActor,
  TicketActivitySource,
  CuratedTicketField,
  TicketActivityFieldChange,
  TicketActivityChanges,
  TicketActivityActorInfo,
  WriteTicketActivityInput,
  TicketActivityRow,
} from './types';

export { writeTicketActivity } from './writeTicketActivity';

export {
  buildCuratedTicketDiff,
  buildCuratedTicketDiffWithLabels,
  hasCuratedChanges,
} from './curatedTicketDiff';
export type { LabelResolutionMap } from './curatedTicketDiff';

export {
  readTicketActivity,
  buildUnifiedTicketTimeline,
} from './readTicketActivity';
export type {
  TicketTimelineEntry,
  TicketTimelineEntryType,
} from './readTicketActivity';
