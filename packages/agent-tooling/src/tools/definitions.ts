/**
 * The constant meta-tool surface exposed over MCP (and mirrored by the EE chat
 * loop). Three tools, independent of API size — progressive disclosure via
 * search-then-execute. `finish_response` from the chat loop is intentionally
 * omitted: in MCP the host model ends its own turn.
 */

export type Edition = 'ce' | 'ee';

/** Transport-neutral tool definition (maps directly to an MCP tool). */
export interface MetaToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input (MCP `inputSchema`). */
  inputSchema: Record<string, unknown>;
}

export const SEARCH_API_REGISTRY_TOOL = 'search_api_registry';
export const SEARCH_BUSINESS_DATA_TOOL = 'search_business_data';
export const CALL_API_ENDPOINT_TOOL = 'call_api_endpoint';

export interface BuildMetaToolOptions {
  edition: Edition;
  /**
   * Optional allow-list of business-data object types. When provided it
   * constrains `search_business_data.types`; otherwise the param is a free
   * string array (the server filters unknown types).
   */
  businessDataTypes?: readonly string[];
}

function callApiEndpointDescription(edition: Edition): string {
  const base =
    'Invoke a documented API endpoint by its registry identifier (entryId from search_api_registry). ' +
    'Include any path, query, header, or body parameters the endpoint requires. ' +
    'Prefer narrow list calls with limit/fields, then detail endpoints once you have an ID.';
  if (edition === 'ee') {
    return (
      base +
      ' GET endpoints execute automatically and return results. POST/PUT/PATCH/DELETE are governed:' +
      ' they run under the connecting agent\'s policy and may be held for human approval before execution.'
    );
  }
  return (
    base +
    ' All endpoints execute immediately under your AlgaPSA user permissions (RBAC/ABAC); there is no' +
    ' separate approval step. GET reads data; POST/PUT/PATCH/DELETE mutate it, so confirm intent with' +
    ' the user before destructive calls.'
  );
}

export function buildMetaToolDefinitions(options: BuildMetaToolOptions): MetaToolDefinition[] {
  const { edition, businessDataTypes } = options;

  const typesItems =
    businessDataTypes && businessDataTypes.length > 0
      ? { type: 'string', enum: [...businessDataTypes] }
      : { type: 'string' };

  return [
    {
      name: SEARCH_API_REGISTRY_TOOL,
      description:
        'Search the AlgaPSA API catalog for relevant endpoints. Use this before calling an endpoint to ' +
        'find the most appropriate entry. Returns ranked descriptors (id, name, method, path, parameters, ' +
        'schema, examples). Query with a natural-language description of the task.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Natural-language description of what you want to do (e.g. "list active service categories" or "get ticket by id").',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results to return (default 5).',
          },
        },
        required: ['query'],
      },
    },
    {
      name: SEARCH_BUSINESS_DATA_TOOL,
      description:
        'Search tenant-scoped business data across tickets, projects, clients, contacts, assets, invoices, ' +
        'services, and knowledge records. Read-only and ACL-scoped to your permissions. Use it to find ' +
        'relevant records before calling detail endpoints. Query should be a concise full-text expression ' +
        '(likely record words, identifiers, names, quoted phrases, OR alternatives) — not a full sentence.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Concise full-text query. Use likely record words, identifiers, names, quoted phrases, and OR alternatives. Avoid filler like "related to" or redundant type words when types is set.',
          },
          types: {
            type: 'array',
            description: 'Optional object types to restrict the search. Omit to search all visible business data.',
            items: typesItems,
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results to return (default 10, max 25).',
          },
          cursor: {
            type: 'string',
            description: 'Optional cursor from a prior search_business_data result.',
          },
          sort: {
            type: 'string',
            description: 'Sort by "relevance" or "recent" (default relevance).',
            enum: ['relevance', 'recent'],
          },
        },
        required: ['query'],
      },
    },
    {
      name: CALL_API_ENDPOINT_TOOL,
      description: callApiEndpointDescription(edition),
      inputSchema: {
        type: 'object',
        properties: {
          entryId: {
            type: 'string',
            description: 'Registry identifier for the endpoint (from search_api_registry). Always provide this.',
          },
          method: {
            type: 'string',
            description: 'HTTP method (defaults to the documented method).',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          },
          path: {
            type: 'object',
            description: 'Values for path parameters, keyed by parameter name.',
            additionalProperties: true,
          },
          query: {
            type: 'object',
            description: 'Values for query-string parameters.',
            additionalProperties: true,
          },
          headers: {
            type: 'object',
            description: 'Additional headers required by the endpoint.',
            additionalProperties: true,
          },
          body: {
            description: 'JSON payload for POST/PUT/PATCH requests.',
          },
        },
        required: ['entryId'],
      },
    },
  ];
}
