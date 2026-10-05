/**
 * Wire contract for smart search: the events the SSE route streams and the
 * request body a list page posts, for any entity that offers it. Entity-neutral
 * on purpose. The ticket and project list pages build against these with their
 * own row and filter types; the enterprise engine (`ee/server/src/services/
 * smartSearch`) produces the events and the enterprise panel consumes them.
 */

/** Entities that offer smart search. The route path and the engine registry key off this. */
export type SmartSearchEntity = 'ticket' | 'project';

export const SMART_SEARCH_ENTITIES: readonly SmartSearchEntity[] = ['ticket', 'project'];

export function isSmartSearchEntity(value: unknown): value is SmartSearchEntity {
  return typeof value === 'string' && (SMART_SEARCH_ENTITIES as readonly string[]).includes(value);
}

/** Middleware allow-list prefix: every smart search stream lives under it. */
export const SMART_SEARCH_STREAM_PATH_PREFIX = '/api/smart-search/';

export function smartSearchStreamPath(entity: SmartSearchEntity): string {
  return `${SMART_SEARCH_STREAM_PATH_PREFIX}${entity}/stream`;
}

export type SmartSearchBucket = 'strong' | 'possible' | 'unlikely';

export interface SmartSearchScoredItem<TRow> {
  row: TRow;
  /** Jev's probability that the row is about what the query describes, in [0, 1]. */
  score: number;
  bucket: SmartSearchBucket;
}

export type SmartSearchEvent<TRow, TMetadata> =
  | { type: 'started'; searchId: string; total: number }
  | {
      type: 'scored';
      items: SmartSearchScoredItem<TRow>[];
      /** Whatever the list page needs alongside rows (tags, avatar urls); shape is per entity. */
      metadata: TMetadata;
      /** Running count of rows scored so far, including this batch. */
      scored: number;
    }
  | {
      type: 'batch_failed';
      ids: string[];
      reason: string;
      /** Running count of rows that could not be scored, including this batch. */
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

export type SmartSearchEventType = SmartSearchEvent<unknown, unknown>['type'];

export interface SmartSearchRequestBody<TScope> {
  /** What defines the candidate set: chip filters, or an explicit id list. Any keyword field is ignored: the typed text is the Jev query only. */
  scope: TScope;
  query: string;
}

/** Error codes the route returns as JSON before a stream opens. */
export type SmartSearchErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ENTERPRISE_EDITION_REQUIRED'
  | 'ADD_ON_REQUIRED'
  | 'SMART_SEARCH_NOT_CONFIGURED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

export interface SmartSearchErrorBody {
  code: SmartSearchErrorCode;
  error: string;
}

export const SMART_SEARCH_QUERY_MAX_LENGTH = 500;

/** What a list page's row loader returns when the panel hydrates rows by id. */
export interface SmartSearchRows<TRow, TMetadata> {
  rows: TRow[];
  metadata: TMetadata;
}
