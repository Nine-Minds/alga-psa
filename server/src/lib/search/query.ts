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
