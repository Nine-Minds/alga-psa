import type {
  IAggregatedReaction,
  ITag,
  ITeam,
  ITicketMaterial,
  TicketTimeEntriesSummary,
} from '@alga-psa/types';
import type { TicketTimelineEntry } from '@alga-psa/shared/lib/ticketActivity';
import type {
  TicketBillingRollup,
  TicketInteractionSummary,
  TicketScheduleEntrySummary,
} from '../actions/ticketBentoActions';
import type { ITicketChecklistItem } from '../actions/checklists/ticketChecklistActions';
import type { ITicketAutoCloseState } from '../actions/close-rules/closeRuleActions';
import type { TicketDetailLayout } from '../actions/ticketLayoutPreference';
import type { AdjacentTicketData } from '../components/ticket/TicketNavigation';

export interface TicketReactionsBootstrap {
  reactions: Record<string, IAggregatedReaction[]>;
  userNames: Record<string, string>;
}

/**
 * Server-gathered startup payload for the ticket details screen. Everything
 * here rides the initial RSC response so the client renders with ZERO
 * fetch-on-mount requests.
 *
 * Two tiers:
 * - Resolved values shape the first paint (layout choice, checklist, …) and
 *   are awaited in the page alongside the consolidated ticket bundle.
 * - `streams` are server-started promises that are NOT awaited by the page;
 *   client tiles resolve them via React `use()` inside <Suspense> boundaries,
 *   so slower queries stream in behind their skeleton fallbacks.
 *
 * Every field is optional-by-null so legacy callers (drawers, tests, client
 * portal) that render TicketDetails without a bootstrap keep the old
 * fetch-on-mount behavior.
 */
export interface TicketScreenBootstrap {
  layoutPreference: { layout: TicketDetailLayout; timelineOrder: 'asc' | 'desc' } | null;
  checklistItems: ITicketChecklistItem[] | null;
  autoCloseState: ITicketAutoCloseState | null;
  canViewCommentMetadataDebug: boolean | null;
  teams: ITeam[] | null;
  displaySettings: { dateTimeFormat?: string; responseStateTrackingEnabled?: boolean } | null;
  tags: ITag[] | null;
  streams: {
    /** Non-comment timeline entries (system/time/alert lanes). */
    timelineEntries: Promise<TicketTimelineEntry[]>;
    /** Reactions for the ticket's comments (decoration: resolved in an effect, never suspends). */
    commentReactions: Promise<TicketReactionsBootstrap>;
    scheduleEntries: Promise<TicketScheduleEntrySummary[]>;
    interactions: Promise<TicketInteractionSummary[]>;
    billingRollup: Promise<TicketBillingRollup | null>;
    /** SLA policy display name (decoration: resolved in an effect). */
    slaPolicyName: Promise<string | null>;
    /** Shared by TimeLoggedSummary and TicketTimeEntries — one query, two consumers. */
    timeEntries: Promise<TicketTimeEntriesSummary | null>;
    materials: Promise<ITicketMaterial[]>;
    /** Prev/next pager data, computed server-side with the request's returnFilters. */
    adjacentTickets: Promise<AdjacentTicketData | null>;
  } | null;
}
