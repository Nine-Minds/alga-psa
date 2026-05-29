import { SEARCH_OBJECT_TYPES } from '@alga-psa/types';

import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerSearchRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Search';

  const SearchObjectType = zOpenApi
    .enum(SEARCH_OBJECT_TYPES)
    .describe('Indexed business object type.');

  const SearchQuery = registry.registerSchema(
    'SearchQuery',
    zOpenApi.object({
      query: zOpenApi
        .string()
        .min(1)
        .max(200)
        .describe(
          'Full-text query. A concise expression of likely record words, identifiers, names, or quoted phrases — not a full sentence. Supports OR for alternatives (e.g. "laptop OR workstation").',
        ),
      types: zOpenApi
        .string()
        .optional()
        .describe(
          `Comma-separated list of object types to restrict the search (e.g. "ticket,project"). Omit to search every type the API key's user is permitted to read. Allowed values: ${SEARCH_OBJECT_TYPES.join(', ')}.`,
        ),
      limit: zOpenApi
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Maximum number of results to return. Defaults to 30; capped at 100.'),
      cursor: zOpenApi
        .string()
        .optional()
        .describe('Opaque pagination cursor copied from a prior response\'s nextCursor.'),
      sort: zOpenApi
        .enum(['relevance', 'recent'])
        .optional()
        .describe('Result ordering. "relevance" (default) ranks by full-text score; "recent" orders by last update.'),
    }),
  );

  const SearchResultRow = registry.registerSchema(
    'SearchResultRow',
    zOpenApi.object({
      type: SearchObjectType,
      id: zOpenApi.string().describe('Object identifier within its type.'),
      parentId: zOpenApi
        .string()
        .optional()
        .describe('Identifier of the parent record for nested results (e.g. the ticket of a ticket comment).'),
      title: zOpenApi.string().describe('Primary display label for the record.'),
      subtitle: zOpenApi.string().optional().describe('Secondary context line.'),
      snippet: zOpenApi
        .string()
        .optional()
        .describe('Matched-text excerpt with <mark> tags around the highlighted terms.'),
      url: zOpenApi.string().describe('Relative in-app URL pointing at the record.'),
      score: zOpenApi.number().describe('Relevance score; higher is more relevant.'),
      updatedAt: zOpenApi.string().datetime().describe('Source record last-updated timestamp.'),
    }),
  );

  const SearchResultData = registry.registerSchema(
    'SearchResultData',
    zOpenApi.object({
      results: zOpenApi.array(SearchResultRow).describe('Matching records for this page, ordered by the requested sort.'),
      groups: zOpenApi
        .record(zOpenApi.number().int())
        .describe('Total match counts keyed by object type (across all pages), before the page limit is applied.'),
      totalCount: zOpenApi.number().int().describe('Total number of matches across all permitted types.'),
      nextCursor: zOpenApi
        .string()
        .optional()
        .describe('Cursor for the next page; absent when the result set fits within the page.'),
    }),
  );

  const SearchResponse = registry.registerSchema(
    'SearchResponse',
    zOpenApi.object({
      data: SearchResultData.describe('Search payload returned by createSuccessResponse.'),
    }),
  );

  const ApiErrorEnvelope = registry.registerSchema(
    'SearchApiErrorEnvelope',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi
          .string()
          .describe('Machine-readable error code such as VALIDATION_ERROR, UNAUTHORIZED, or INTERNAL_ERROR.'),
        message: zOpenApi.string().describe('Human-readable error message.'),
        details: zOpenApi.unknown().optional().describe('Optional structured details, including Zod validation errors.'),
      }),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/search',
    summary: 'Unified full-text search',
    description:
      'Full-text search across all indexed business records (tickets, clients, contacts, projects, assets, invoices, contracts, documents, knowledge-base articles, and more) backed by the shared app_search_index. Results are tenant-scoped and filtered by the API key user\'s permissions: a coarse per-type permission gate plus a per-row access-control check, so only records the user could see in-app are returned. No dedicated search permission is required — any valid API key may call this endpoint. Client-portal API keys are automatically scoped to their own client.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: SearchQuery,
    },
    responses: {
      200: {
        description: 'Matching records returned successfully.',
        schema: SearchResponse,
      },
      400: {
        description: 'Query parameter validation failed (missing/empty query, unknown type, or out-of-range limit).',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'API key is missing or invalid.',
        schema: ApiErrorEnvelope,
      },
      429: {
        description: 'API rate limit exceeded for the key.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error while executing the search.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-acl-filtered': true,
      'x-not-paginated': false,
    },
    edition: 'both',
  });
}
