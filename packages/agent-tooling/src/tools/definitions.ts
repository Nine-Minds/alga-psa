/**
 * The constant meta-tool surface exposed over MCP (and mirrored by the EE chat
 * loop). Three progressive-disclosure tools independent of API size
 * (search-then-execute), plus `attach_file`: the one tool that exists because
 * ChatGPT can only hand a file to a top-level tool parameter declared in
 * `_meta["openai/fileParams"]`, which `call_api_endpoint` (everything nested
 * under `body`) cannot express. `finish_response` from the chat loop is
 * intentionally omitted: in MCP the host model ends its own turn.
 */

export type Edition = 'ce' | 'ee';

/** Transport-neutral tool definition (maps directly to an MCP tool). */
export interface MetaToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input (MCP `inputSchema`). */
  inputSchema: Record<string, unknown>;
  /** Optional MCP `_meta` emitted verbatim in `tools/list` (e.g. OpenAI file params). */
  _meta?: Record<string, unknown>;
}

export const SEARCH_API_REGISTRY_TOOL = 'search_api_registry';
export const SEARCH_BUSINESS_DATA_TOOL = 'search_business_data';
export const CALL_API_ENDPOINT_TOOL = 'call_api_endpoint';
export const ATTACH_FILE_TOOL = 'attach_file';

/** Entities `POST /api/v1/documents` accepts (kept equal to the server's ATTACHABLE_ENTITY_TYPES by a server test). */
export const ATTACH_FILE_ENTITY_TYPES = ['ticket', 'project_task', 'client', 'contact', 'asset'] as const;

/**
 * OpenAI's published file-parameter shape: all four properties declared,
 * `download_url` and `file_id` required, nothing else allowed. ChatGPT's tool
 * scan rejects deviations; a unit test pins this object.
 */
export const OPENAI_FILE_SCHEMA = {
  type: 'object',
  properties: {
    download_url: { type: 'string', description: 'Temporary signed URL of the file (supplied by ChatGPT).' },
    file_id: { type: 'string', description: 'ChatGPT file identifier.' },
    mime_type: { type: 'string', description: 'MIME type of the file, when known.' },
    file_name: { type: 'string', description: 'Original file name, when known.' },
  },
  required: ['download_url', 'file_id'],
  additionalProperties: false,
} as const;

/** `initialize.instructions` sent by both the hosted MCP server and the stdio connector. */
export const MCP_SERVER_INSTRUCTIONS =
  'AlgaPSA tools: search_api_registry finds endpoints, call_api_endpoint runs them, search_business_data searches records. ' +
  'To attach a file the user provided to a ticket, project task, client, contact or asset, use attach_file: ' +
  'pass the user\'s attachment as `file` (ChatGPT) or give an https `url`. ' +
  'A `url` must be on the workspace\'s allowed download hosts; if it is refused (FETCH_HOST_NOT_ALLOWED), ' +
  'tell the user that a workspace admin can add that host under Settings > MCP Server, and do not retry with other URLs. ' +
  'Never ask the user for an API key. ' +
  'Never base64-encode a file you did not author yourself; content_base64 is only for small text you wrote. ' +
  'call_api_endpoint cannot send multipart/form-data, so do not use it to upload files. ' +
  'Attach one file per call; for several files make several calls.';

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
        'find the most appropriate entry. Returns ranked endpoint descriptors (entryId, method, path, parameters, ' +
        'requestBodySchema for write endpoints, and an example). Use requestBodySchema to build ' +
        'call_api_endpoint bodies. Query with a natural-language description of the task.',
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
            description: 'Maximum number of results to return (default 5, max 25).',
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
    {
      name: ATTACH_FILE_TOOL,
      description:
        'Attach ONE file to a ticket, project task, client, contact or asset. Provide exactly one source: ' +
        '`file` (an attachment the user gave you in ChatGPT; it arrives as an object with a download_url), ' +
        '`url` (an https link the server downloads, preferred for any other file; it must be on the workspace\'s allowed download hosts), or ' +
        '`content_base64` (only small content you wrote yourself; never base64 a user-provided file). ' +
        '`file_name` is required with content_base64 and otherwise defaults from the file or URL. ' +
        'If a url is refused with FETCH_HOST_NOT_ALLOWED, tell the user a workspace admin can add that host under Settings > MCP Server > Allowed download hosts; do not retry with other URLs and never ask for an API key. ' +
        'Call once per file. If the file did not arrive (missing or not a download link), ask the user to re-attach it from ChatGPT web or desktop.',
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            description: 'Kind of record to attach the file to.',
            enum: [...ATTACH_FILE_ENTITY_TYPES],
          },
          entity_id: {
            type: 'string',
            description: 'UUID of the record (find it with search_business_data or search_api_registry).',
          },
          file: { $ref: '#/$defs/OpenAIFile' },
          url: {
            type: 'string',
            description: 'https URL of the file for the server to download; the host must be on the workspace\'s allowed download hosts. Use instead of `file` / `content_base64`.',
          },
          content_base64: {
            type: 'string',
            description: 'Standard base64 of small content you authored yourself. Requires file_name.',
          },
          file_name: {
            type: 'string',
            description: 'File name with extension. Required with content_base64; otherwise optional.',
          },
          mime_type: {
            type: 'string',
            description: 'MIME type, if known. Optional; the server also inspects the bytes.',
          },
        },
        required: ['entity_type', 'entity_id'],
        $defs: { OpenAIFile: OPENAI_FILE_SCHEMA },
      },
      _meta: { 'openai/fileParams': ['file'] },
    },
  ];
}
