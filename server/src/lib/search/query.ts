import type { Knex } from 'knex';

import type { SearchObjectType } from './types';

const MAX_SEARCH_QUERY_CHARS = 200;
const IDENTIFIER_QUERY_PATTERN = /^[A-Z]+-?\d+$/i;

export type SearchQueryErrorCode = 'empty_query' | 'query_too_long';

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
}

export interface SearchQueryOptions {
  knex: Knex;
  tenant: string;
  query: string;
  allowedTypes: SearchObjectType[];
  limit?: number;
  offset?: number;
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

  const isIdentifierLike = IDENTIFIER_QUERY_PATTERN.test(trimmed);
  const identifier = isIdentifierLike ? trimmed.toLowerCase() : undefined;

  return {
    raw: trimmed,
    normalized: identifier ?? trimmed,
    isIdentifierLike,
    identifier,
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
  };
}

export async function runSearchQuery(options: SearchQueryOptions): Promise<SearchIndexHit[]> {
  const parsed = parseQuery(options.query);
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);

  if (options.allowedTypes.length === 0) {
    return [];
  }

  const result = await options.knex.raw<{ rows: SearchIndexHitRow[] }>(
    `
      WITH q AS (
        SELECT
          websearch_to_tsquery('english', ?) AS tsq,
          ?::text AS raw,
          ?::text AS identifier
      )
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
        CASE
          WHEN q.identifier IS NOT NULL
            AND lower(coalesce(s.metadata->>'identifier', '')) = q.identifier
          THEN 1000
          ELSE (
            (
              ts_rank_cd(s.search_vector, q.tsq)
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
      FROM app_search_index s
      CROSS JOIN q
      WHERE s.tenant = ?::uuid
        AND s.object_type = ANY(?::text[])
        AND (
          s.search_vector @@ q.tsq
          OR s.title % q.raw
          OR coalesce(s.subtitle, '') % q.raw
          OR (
            q.identifier IS NOT NULL
            AND lower(coalesce(s.metadata->>'identifier', '')) = q.identifier
          )
        )
      ORDER BY score DESC, s.source_updated_at DESC, s.object_id ASC
      LIMIT ?
      OFFSET ?
    `,
    [parsed.raw, parsed.raw, parsed.identifier ?? null, options.tenant, options.allowedTypes, limit, offset],
  );

  return result.rows.map(toSearchHit);
}
