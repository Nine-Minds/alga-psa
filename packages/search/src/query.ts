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

function scopedSearchIndexSql(knex: Knex, tenant: string): { sql: string; bindings: Knex.RawBinding[] } {
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

export async function runSearchQuery(options: SearchQueryOptions): Promise<SearchIndexHit[]> {
  const parsed = parseQuery(options.query);
  const limit = normalizeLimit(options.limit);
  const cursor = decodeSearchCursor(options.cursor);
  const offset = cursor ? 0 : normalizeOffset(options.offset);
  const includeSnippets = options.includeSnippets ?? true;
  const sort = options.sort ?? 'relevance';

  if (options.allowedTypes.length === 0) {
    return [];
  }

  const aclPredicate = options.acl
    ? aclPredicateSql(options.acl)
    : { sql: 'TRUE', bindings: [] };
  const searchIndex = scopedSearchIndexSql(options.knex, options.tenant);
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

  const result = await options.knex.raw<{ rows: SearchIndexHitRow[] }>(
    `
      WITH q AS (
        SELECT
          websearch_to_tsquery('english', ?) AS tsq,
          CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
          ?::text AS raw,
          ?::text AS identifier
      ),
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
      SELECT *
      FROM ranked
      WHERE (${cursorPredicateSql})
      ORDER BY ${orderBySql}
      LIMIT ?
      OFFSET ?
    `,
    [
      parsed.raw,
      parsed.prefixTsquery,
      parsed.prefixTsquery,
      parsed.raw,
      parsed.identifier ?? null,
      ...searchIndex.bindings,
      options.allowedTypes,
      ...aclPredicate.bindings,
      ...cursorBindings,
      limit,
      offset,
    ] as Knex.RawBinding[],
  );

  return result.rows.map(toSearchHit);
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
  const empty = {} as Record<SearchObjectType, number>;

  if (options.allowedTypes.length === 0) {
    return empty;
  }

  const aclPredicate = options.acl
    ? aclPredicateSql(options.acl)
    : { sql: 'TRUE', bindings: [] };
  const searchIndex = scopedSearchIndexSql(options.knex, options.tenant);

  const result = await options.knex.raw<{ rows: Array<{ object_type: SearchObjectType; total: string | number }> }>(
    `
      WITH q AS (
        SELECT
          websearch_to_tsquery('english', ?) AS tsq,
          CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
          ?::text AS raw,
          ?::text AS identifier
      )
      SELECT s.object_type, count(*)::bigint AS total
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
      GROUP BY s.object_type
    `,
    [
      parsed.raw,
      parsed.prefixTsquery,
      parsed.prefixTsquery,
      parsed.raw,
      parsed.identifier ?? null,
      ...searchIndex.bindings,
      options.allowedTypes,
      ...aclPredicate.bindings,
    ] as Knex.RawBinding[],
  );

  const counts = {} as Record<SearchObjectType, number>;
  for (const row of result.rows) {
    counts[row.object_type] = Number(row.total);
  }
  return counts;
}

export async function countSearchMatches(
  options: Omit<SearchQueryOptions, 'limit' | 'offset' | 'cursor' | 'sort' | 'includeSnippets'>,
): Promise<number> {
  const parsed = parseQuery(options.query);

  if (options.allowedTypes.length === 0) {
    return 0;
  }

  const aclPredicate = options.acl
    ? aclPredicateSql(options.acl)
    : { sql: 'TRUE', bindings: [] };
  const searchIndex = scopedSearchIndexSql(options.knex, options.tenant);

  const result = await options.knex.raw<{ rows: Array<{ total: string | number }> }>(
    `
      WITH q AS (
        SELECT
          websearch_to_tsquery('english', ?) AS tsq,
          CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
          ?::text AS raw,
          ?::text AS identifier
      )
      SELECT count(*)::bigint AS total
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
    `,
    [
      parsed.raw,
      parsed.prefixTsquery,
      parsed.prefixTsquery,
      parsed.raw,
      parsed.identifier ?? null,
      ...searchIndex.bindings,
      options.allowedTypes,
      ...aclPredicate.bindings,
    ] as Knex.RawBinding[],
  );

  return Number(result.rows[0]?.total ?? 0);
}
