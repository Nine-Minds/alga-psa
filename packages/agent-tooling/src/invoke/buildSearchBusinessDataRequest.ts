import type { BuiltRequest } from './buildRequest';

export const DEFAULT_SEARCH_PATH = '/api/v1/search';

/** Map `search_business_data` arguments onto `GET <searchPath>`. Pure; the query-parameter order is part of the wire contract. */
export function buildSearchBusinessDataRequest(
  args: Record<string, unknown>,
  searchPath: string = DEFAULT_SEARCH_PATH,
): BuiltRequest {
  const query: Record<string, string> = {};
  query.query = typeof args.query === 'string' ? args.query : '';
  if (Array.isArray(args.types) && args.types.length > 0) query.types = args.types.map(String).join(',');
  if (args.limit !== undefined && args.limit !== null) query.limit = String(args.limit);
  if (args.cursor) query.cursor = String(args.cursor);
  if (args.sort) query.sort = String(args.sort);
  return { method: 'GET', path: searchPath, query, headers: {}, isMutation: false };
}
