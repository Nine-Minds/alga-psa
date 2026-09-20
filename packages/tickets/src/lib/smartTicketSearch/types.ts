/**
 * Wire contract for smart ticket search: the events the SSE route streams and
 * the request body the Tickets page posts. Lives in the CE tickets package so
 * the CE shell, the dashboard, the CE route file, and the EE implementation all
 * build against one definition. The EE runner (`ee/server/src/services/
 * smartTicketSearch`) produces these events; the EE panel consumes them.
 */

import type { ITag, ITicketListFilters, ITicketListItem } from '@alga-psa/types';

export const SMART_TICKET_SEARCH_STREAM_PATH = '/api/tickets/smart-search/stream';

export type SmartSearchBucket = 'strong' | 'possible' | 'unlikely';

export interface SmartSearchScoredItem {
  ticket: ITicketListItem;
  /** Jev's probability that the ticket is about what the query describes, in [0, 1]. */
  score: number;
  bucket: SmartSearchBucket;
}

export interface SmartSearchRowMetadata {
  agentAvatarUrls: Record<string, string | null>;
  teamAvatarUrls: Record<string, string | null>;
  ticketTags: Record<string, ITag[]>;
}

export type SmartSearchEvent =
  | { type: 'started'; searchId: string; total: number }
  | {
      type: 'scored';
      items: SmartSearchScoredItem[];
      metadata: SmartSearchRowMetadata;
      /** Running count of tickets scored so far, including this batch. */
      scored: number;
    }
  | {
      type: 'batch_failed';
      ticketIds: string[];
      reason: string;
      /** Running count of tickets that could not be scored, including this batch. */
      failed: number;
    }
  | {
      type: 'done';
      total: number;
      scored: number;
      failed: number;
      requests: number;
      inputTokens: number;
      model: string | null;
      durationMs: number;
    };

export type SmartSearchEventType = SmartSearchEvent['type'];

export interface SmartTicketSearchRequestBody {
  /** The chip filters. `searchQuery` is ignored: the typed text is the Jev query only. */
  filters: ITicketListFilters;
  query: string;
}

/** Error codes the route returns as JSON before a stream opens. */
export type SmartTicketSearchErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ENTERPRISE_EDITION_REQUIRED'
  | 'FEATURE_FLAG_OFF'
  | 'ADD_ON_REQUIRED'
  | 'SMART_SEARCH_NOT_CONFIGURED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

export interface SmartTicketSearchErrorBody {
  code: SmartTicketSearchErrorCode;
  error: string;
}

export const SMART_SEARCH_QUERY_MAX_LENGTH = 500;
