import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { aclPredicateSql, type SearchAclPrincipal } from './acl';
import type { SearchObjectType } from '@alga-psa/types';

const MAX_SEARCH_QUERY_CHARS = 200;
const IDENTIFIER_QUERY_PATTERN = /^[A-Z]+-?\d+$/i;
const IDENTIFIER_TOKEN_PATTERN = /\b[A-Z]+-?\d+\b/i;
const HEADLINE_START_SENTINEL = '__SEARCH_MARK_START__';
const HEADLINE_STOP_SENTINEL = '__SEARCH_MARK_STOP__';

export type SearchQueryErrorCode = 'empty_query' | 'query_too_long' | 'invalid_cursor';

export class SearchQueryError extends Error {
  constructor(
    public readonly code: SearchQueryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SearchQueryError';
  }
}

export interface ParsedSearchQuery {
  raw: string;
  normalized: string;
  isIdentifierLike: boolean;
  identifier?: string;
  prefixTsquery: string | null;
}

const TSQUERY_UNSAFE_RE = /[^\p{L}\p{N}\s]+/gu;

export function buildPrefixTsquery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(TSQUERY_UNSAFE_RE, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}:*`).join(' & ');
}

export interface SearchQueryOptions {
  knex: Knex;
  tenant: string;
  query: string;
  allowedTypes: SearchObjectType[];
  limit?: number;
  offset?: number;
  cursor?: string;
  sort?: 'relevance' | 'recent';
  includeSnippets?: boolean;
  acl?: SearchAclPrincipal;
  /**
   * Admitted, redacted relation standing in for the tenant's raw `app_search_index`.
   * Ranking, pagination, counts and typeahead all read this one relation, so a masked
   * term can never leak through any of them. Produced by `projectSearchAccess`.
   */
  searchIndex?: { sql: string; bindings: Knex.RawBinding[] };
}

export interface SearchIndexHit {
  type: SearchObjectType;
  id: string;
  parentType?: SearchObjectType;
  parentId?: string;
  title: string;
  subtitle?: string;
  url: string;
  score: number;
  updatedAt: Date;
  metadata: Record<string, unknown>;
  snippet?: string;
}

interface SearchIndexHitRow {
  object_type: SearchObjectType;
  object_id: string;
  parent_type: SearchObjectType | null;
  parent_id: string | null;
  title: string;
  subtitle: string | null;
  url: string;
  score: number | string;
  source_updated_at: Date | string;
  metadata: Record<string, unknown> | string | null;
  snippet: string | null;
}

interface SearchCursorPayload {
  score: number;
  updatedAt: string;
  objectId: string;
}

function scopedSearchIndexSql(knex: Knex, tenant: string, override?: SearchQueryOptions['searchIndex']): { sql: string; bindings: Knex.RawBinding[] } {
  if (override) return { sql: override.sql, bindings: [...override.bindings] };
  const scoped = tenantDb(knex, tenant)
    .table('app_search_index')
    .select('*')
    .toSQL();

  return {
    sql: `(${scoped.sql}) s`,
    bindings: scoped.bindings as Knex.RawBinding[],
  };
}

export function parseQuery(raw: string): ParsedSearchQuery {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    throw new SearchQueryError('empty_query', 'Search query is required');
  }

  if (trimmed.length > MAX_SEARCH_QUERY_CHARS) {
    throw new SearchQueryError(
      'query_too_long',
      `Search query must be ${MAX_SEARCH_QUERY_CHARS} characters or fewer`,
    );
  }

  const exactIdentifierMatch = IDENTIFIER_QUERY_PATTERN.test(trimmed);
  const identifierToken = trimmed.match(IDENTIFIER_TOKEN_PATTERN)?.[0];
  const identifier = identifierToken ? identifierToken.toLowerCase() : undefined;

  return {
    raw: trimmed,
    normalized: exactIdentifierMatch && identifier ? identifier : trimmed,
    isIdentifierLike: Boolean(identifier),
    identifier,
    prefixTsquery: buildPrefixTsquery(trimmed),
  };
}

function normalizeLimit(limit: number | undefined): number {
  const parsed = Number(limit ?? 30);
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 100));
}

function normalizeOffset(offset: number | undefined): number {
  const parsed = Number(offset ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function parseMetadata(value: SearchIndexHitRow['metadata']): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHeadline(raw: string): string {
  let cursor = 0;
  let sanitized = '';

  while (cursor < raw.length) {
    const nextStart = raw.indexOf(HEADLINE_START_SENTINEL, cursor);
    const nextStop = raw.indexOf(HEADLINE_STOP_SENTINEL, cursor);

    if (nextStop >= 0 && (nextStart < 0 || nextStop < nextStart)) {
      return escapeHtml(raw);
    }

    if (nextStart < 0) {
      sanitized += escapeHtml(raw.slice(cursor));
      break;
    }

    sanitized += escapeHtml(raw.slice(cursor, nextStart));

    const markedStart = nextStart + HEADLINE_START_SENTINEL.length;
    const markedStop = raw.indexOf(HEADLINE_STOP_SENTINEL, markedStart);
    if (markedStop < 0) {
      return escapeHtml(raw);
    }

    const markedText = raw.slice(markedStart, markedStop);
    if (markedText.includes(HEADLINE_START_SENTINEL)) {
      return escapeHtml(raw);
    }

    sanitized += `<mark>${escapeHtml(markedText)}</mark>`;
    cursor = markedStop + HEADLINE_STOP_SENTINEL.length;
  }

  return sanitized;
}

function toSearchHit(row: SearchIndexHitRow): SearchIndexHit {
  return {
    type: row.object_type,
    id: row.object_id,
    parentType: row.parent_type ?? undefined,
    parentId: row.parent_id ?? undefined,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    url: row.url,
    score: Number(row.score) || 0,
    updatedAt: new Date(row.source_updated_at),
    metadata: parseMetadata(row.metadata),
    snippet: row.snippet ? sanitizeHeadline(row.snippet) : undefined,
  };
}

export function encodeSearchCursor(hit: Pick<SearchIndexHit, 'score' | 'updatedAt' | 'id'>): string {
  const payload: SearchCursorPayload = {
    score: hit.score,
    updatedAt: hit.updatedAt.toISOString(),
    objectId: hit.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeSearchCursor(cursor: string | undefined): SearchCursorPayload | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !decoded
      || typeof decoded !== 'object'
      || typeof decoded.score !== 'number'
      || typeof decoded.updatedAt !== 'string'
      || typeof decoded.objectId !== 'string'
    ) {
      throw new Error('Invalid cursor payload');
    }

    const updatedAt = new Date(decoded.updatedAt);
    if (!Number.isFinite(updatedAt.getTime())) {
      throw new Error('Invalid cursor timestamp');
    }

    return {
      score: decoded.score,
      updatedAt: updatedAt.toISOString(),
      objectId: decoded.objectId,
    };
  } catch (error) {
    throw new SearchQueryError('invalid_cursor', 'Search cursor is invalid');
  }
}

type SqlFragment = { sql: string; bindings: Knex.RawBinding[] };

/**
 * The `q` and `matched` CTEs every search statement starts from: `matched` is each index row of an
 * allowed type that the principal may see and the query matches. Ranking, pagination, counts and
 * typeahead all read `matched`, so they cannot disagree about which rows exist. `matched` is NOT
 * MATERIALIZED: a statement that reads it twice (a page and its counts) gets each read planned
 * against the index, as two separate statements would.
 */
function matchedRelationSql(
  options: Pick<SearchQueryOptions, 'knex' | 'tenant' | 'allowedTypes' | 'acl' | 'searchIndex'>,
  parsed: ParsedSearchQuery,
): SqlFragment {
  const aclPredicate = options.acl
    ? aclPredicateSql(options.acl)
    : { sql: 'TRUE', bindings: [] };
  const searchIndex = scopedSearchIndexSql(options.knex, options.tenant, options.searchIndex);

  return {
    sql: `
      q AS (
        SELECT
          websearch_to_tsquery('english', ?) AS tsq,
          CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
          ?::text AS raw,
          ?::text AS identifier
      ),
      matched AS NOT MATERIALIZED (
        SELECT s.*
        FROM ${searchIndex.sql}
        CROSS JOIN q
        WHERE s.object_type = ANY(?::text[])
          AND ${aclPredicate.sql}
          AND (
            s.search_vector @@ q.tsq
            OR (q.prefix_tsq IS NOT NULL AND s.search_vector @@ q.prefix_tsq)
            OR s.title ILIKE '%' || q.raw || '%'
            OR coalesce(s.subtitle, '') ILIKE '%' || q.raw || '%'
            OR s.title % q.raw
            OR coalesce(s.subtitle, '') % q.raw
            OR (
              q.identifier IS NOT NULL
              AND lower(coalesce(s.metadata->>'identifier', '')) = q.identifier
            )
            OR (
              q.identifier IS NOT NULL
              AND lower(coalesce(s.metadata->>'identifier', '')) LIKE q.identifier || '%'
            )
          )
      )
    `,
    bindings: [
      parsed.raw,
      parsed.prefixTsquery,
      parsed.prefixTsquery,
      parsed.raw,
      parsed.identifier ?? null,
      ...searchIndex.bindings,
      options.allowedTypes,
      ...aclPredicate.bindings,
    ] as Knex.RawBinding[],
  };
}

/** The `ranked` CTE (score and snippet over `matched`) and the `page` CTE (cursor, order, limit). */
function rankedPageSql(
  options: Pick<SearchQueryOptions, 'limit' | 'offset' | 'cursor' | 'sort' | 'includeSnippets'>,
): SqlFragment & { orderBySql: string } {
  const limit = normalizeLimit(options.limit);
  const cursor = decodeSearchCursor(options.cursor);
  const offset = cursor ? 0 : normalizeOffset(options.offset);
  const includeSnippets = options.includeSnippets ?? true;
  const sort = options.sort ?? 'relevance';

  const cursorPredicateSql = sort === 'recent'
    ? `
        ?::timestamptz IS NULL
        OR source_updated_at < ?::timestamptz
        OR (
          source_updated_at = ?::timestamptz
          AND object_id > ?
        )
      `
    : `
        ?::double precision IS NULL
        OR score < ?::double precision
        OR (
          score = ?::double precision
          AND source_updated_at < ?::timestamptz
        )
        OR (
          score = ?::double precision
          AND source_updated_at = ?::timestamptz
          AND object_id > ?
        )
      `;
  const cursorBindings = sort === 'recent'
    ? [
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.objectId ?? null,
    ]
    : [
      cursor?.score ?? null,
      cursor?.score ?? null,
      cursor?.score ?? null,
      cursor?.updatedAt ?? null,
      cursor?.score ?? null,
      cursor?.updatedAt ?? null,
      cursor?.objectId ?? null,
    ];
  const orderBySql = sort === 'recent'
    ? 'source_updated_at DESC, object_id ASC'
    : 'score DESC, source_updated_at DESC, object_id ASC';
  const snippetSelectSql = includeSnippets
    ? `
          ts_headline(
            'english',
            coalesce(s.body, ''),
            q.tsq,
            'MaxFragments=2,StartSel=${HEADLINE_START_SENTINEL},StopSel=${HEADLINE_STOP_SENTINEL}'
          ) AS snippet
      `
    : 'NULL AS snippet';

  return {
    orderBySql,
    sql: `
      ranked AS (
        SELECT
          s.object_type,
          s.object_id,
          s.parent_type,
          s.parent_id,
          s.title,
          s.subtitle,
          s.url,
          s.source_updated_at,
          s.metadata,
          ${snippetSelectSql},
          CASE
            WHEN q.identifier IS NOT NULL
              AND lower(coalesce(s.metadata->>'identifier', '')) = q.identifier
            THEN 1000
            WHEN q.identifier IS NOT NULL
              AND lower(coalesce(s.metadata->>'identifier', '')) LIKE q.identifier || '%'
            THEN 900
            ELSE (
              (
                ts_rank_cd(s.search_vector, q.tsq)
                + CASE WHEN q.prefix_tsq IS NOT NULL THEN ts_rank_cd(s.search_vector, q.prefix_tsq) * 0.7 ELSE 0 END
                + GREATEST(
                    similarity(s.title, q.raw),
                    similarity(coalesce(s.subtitle, ''), q.raw)
                  ) * 0.4
              )
              * GREATEST(
                  exp(-EXTRACT(epoch FROM (now() - s.source_updated_at)) / (90 * 86400)),
                  0.05
                )
            )
          END AS score
        FROM matched s
        CROSS JOIN q
      ),
      page AS (
        SELECT *
        FROM ranked
        WHERE (${cursorPredicateSql})
        ORDER BY ${orderBySql}
        LIMIT ?
        OFFSET ?
      )
    `,
    bindings: [...cursorBindings, limit, offset] as Knex.RawBinding[],
  };
}

function toTypeCounts(rows: Array<{ object_type: SearchObjectType; total: string | number }>): Record<SearchObjectType, number> {
  const counts = {} as Record<SearchObjectType, number>;
  for (const row of rows) {
    counts[row.object_type] = Number(row.total);
  }
  return counts;
}

export async function runSearchQuery(options: SearchQueryOptions): Promise<SearchIndexHit[]> {
  const parsed = parseQuery(options.query);
  const page = rankedPageSql(options);

  if (options.allowedTypes.length === 0) {
    return [];
  }

  const matched = matchedRelationSql(options, parsed);
  const result = await options.knex.raw<{ rows: SearchIndexHitRow[] }>(
    `
      WITH ${matched.sql},
      ${page.sql}
      SELECT *
      FROM page
      ORDER BY ${page.orderBySql}
    `,
    [...matched.bindings, ...page.bindings] as Knex.RawBinding[],
  );

  return result.rows.map(toSearchHit);
}

export interface SearchPage {
  hits: SearchIndexHit[];
  /** Matches per type over the whole result set, not just this page. */
  countsByType: Record<SearchObjectType, number>;
}

/**
 * One page of hits and the per-type match counts, read from one `matched` relation in one
 * statement. The full search answers both on every request; asking separately would cost a
 * second round trip that re-derives the same relation.
 */
export async function runSearchPage(options: SearchQueryOptions): Promise<SearchPage> {
  const parsed = parseQuery(options.query);
  const page = rankedPageSql(options);

  if (options.allowedTypes.length === 0) {
    return { hits: [], countsByType: {} as Record<SearchObjectType, number> };
  }

  const matched = matchedRelationSql(options, parsed);
  const result = await options.knex.raw<{
    rows: Array<{
      hits: SearchIndexHitRow[] | string | null;
      counts: Array<{ object_type: SearchObjectType; total: string | number }> | string | null;
    }>;
  }>(
    `
      WITH ${matched.sql},
      ${page.sql},
      counts AS (
        SELECT object_type, count(*)::bigint AS total
        FROM matched
        GROUP BY object_type
      )
      SELECT
        (SELECT coalesce(json_agg(page ORDER BY ${page.orderBySql}), '[]'::json) FROM page) AS hits,
        (SELECT coalesce(json_agg(counts), '[]'::json) FROM counts) AS counts
    `,
    [...matched.bindings, ...page.bindings] as Knex.RawBinding[],
  );

  const row = result.rows[0];
  const hits = parseJsonColumn<SearchIndexHitRow[]>(row?.hits) ?? [];
  const counts = parseJsonColumn<Array<{ object_type: SearchObjectType; total: string | number }>>(row?.counts) ?? [];
  return { hits: hits.map(toSearchHit), countsByType: toTypeCounts(counts) };
}

function parseJsonColumn<T>(value: T | string | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

export async function runSearchTypeaheadQuery(
  options: Omit<SearchQueryOptions, 'limit' | 'includeSnippets'>,
): Promise<SearchIndexHit[]> {
  return runSearchQuery({
    ...options,
    limit: 5,
    includeSnippets: false,
  });
}

export async function countSearchMatchesByType(
  options: Omit<SearchQueryOptions, 'limit' | 'offset' | 'cursor' | 'sort' | 'includeSnippets'>,
): Promise<Record<SearchObjectType, number>> {
  const parsed = parseQuery(options.query);

  if (options.allowedTypes.length === 0) {
    return {} as Record<SearchObjectType, number>;
  }

  const matched = matchedRelationSql(options, parsed);
  const result = await options.knex.raw<{ rows: Array<{ object_type: SearchObjectType; total: string | number }> }>(
    `
      WITH ${matched.sql}
      SELECT object_type, count(*)::bigint AS total
      FROM matched
      GROUP BY object_type
    `,
    matched.bindings,
  );

  return toTypeCounts(result.rows);
}

export async function countSearchMatches(
  options: Omit<SearchQueryOptions, 'limit' | 'offset' | 'cursor' | 'sort' | 'includeSnippets'>,
): Promise<number> {
  const parsed = parseQuery(options.query);

  if (options.allowedTypes.length === 0) {
    return 0;
  }

  const matched = matchedRelationSql(options, parsed);
  const result = await options.knex.raw<{ rows: Array<{ total: string | number }> }>(
    `
      WITH ${matched.sql}
      SELECT count(*)::bigint AS total
      FROM matched
    `,
    matched.bindings,
  );

  return Number(result.rows[0]?.total ?? 0);
}
