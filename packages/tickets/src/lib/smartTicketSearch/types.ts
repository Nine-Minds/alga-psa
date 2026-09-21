/**
 * The ticket flavor of the smart search wire contract: rows are ticket list
 * items, the scope is the chip filters, and each scored batch carries the tags
 * and avatar urls the Tickets table needs. The entity-neutral contract lives in
 * `@alga-psa/ui/lib/smartSearch/types`; the enterprise engine produces these
 * events for the `ticket` entity.
 */

import type { ITag, ITicketListFilters, ITicketListItem } from '@alga-psa/types';
import type {
  SmartSearchEvent,
  SmartSearchRequestBody,
  SmartSearchScoredItem,
} from '@alga-psa/ui/lib/smartSearch/types';

export type TicketSmartSearchScope = ITicketListFilters;

export interface TicketSmartSearchRowMetadata {
  agentAvatarUrls: Record<string, string | null>;
  teamAvatarUrls: Record<string, string | null>;
  ticketTags: Record<string, ITag[]>;
}

export type TicketSmartSearchScoredItem = SmartSearchScoredItem<ITicketListItem>;
export type TicketSmartSearchEvent = SmartSearchEvent<ITicketListItem, TicketSmartSearchRowMetadata>;
export type TicketSmartSearchRequestBody = SmartSearchRequestBody<TicketSmartSearchScope>;
