import { runRegistrySearch } from '../registry/searchResult';
import type { ChatApiRegistryEntry } from '../registry/schema';
import { buildRequest, type BuiltRequest, type CallEndpointArgs } from '../invoke/buildRequest';
import { buildAttachFileRequest, AttachFileInputError } from '../invoke/buildAttachFileRequest';
import { buildReadAttachmentRequest, ReadAttachmentInputError } from '../invoke/buildReadAttachmentRequest';
import { buildSearchBusinessDataRequest, DEFAULT_SEARCH_PATH } from '../invoke/buildSearchBusinessDataRequest';
import {
  ATTACH_FILE_TOOL,
  CALL_API_ENDPOINT_TOOL,
  READ_ATTACHMENT_TOOL,
  SEARCH_API_REGISTRY_TOOL,
  SEARCH_BUSINESS_DATA_TOOL,
} from '../tools/definitions';
import { jsonToolResult, type ToolResult } from '../content/blocks';
import { upstreamBodyData, type UpstreamBody } from '../content/readResponseBody';
import { attachmentReadToToolResult } from '../content/attachmentRead';

export interface MetaToolTransport {
  /** Send a built request to the instance; the caller owns auth, base URL, act-as and timeouts. */
  send(
    req: BuiltRequest,
    opts?: { actAsUserId?: string | null },
  ): Promise<{ status: number; ok: boolean; body: UpstreamBody }>;
}

export interface MetaToolContext {
  registry: ChatApiRegistryEntry[];
  transport: MetaToolTransport;
  /** Hosted agent sessions only; the connector never sets it. */
  actAsUserId?: string | null;
  /** Business-search path (the connector lets operators override it). */
  searchPath?: string;
}

/** Resolve a registry entry by its id, tolerating `-`/`_` id variants. */
export function resolveRegistryEntry(registry: ChatApiRegistryEntry[], entryId: unknown): ChatApiRegistryEntry | null {
  const want = String(entryId ?? '').replace(/-/g, '_');
  if (!want) return null;
  return registry.find((e) => e.id.replace(/-/g, '_') === want) ?? null;
}

const toolError = (message: string): ToolResult => jsonToolResult({ error: message }, true);

type Handler = (args: Record<string, unknown>, ctx: MetaToolContext) => Promise<ToolResult>;

async function sendAsJson(
  ctx: MetaToolContext,
  built: BuiltRequest,
  opts?: { actAsUserId?: string | null },
): Promise<ToolResult> {
  const r = await ctx.transport.send(built, opts);
  return jsonToolResult({ status: r.status, ok: r.ok, data: upstreamBodyData(r.body) }, !r.ok, r.status);
}

const HANDLERS: Record<string, Handler> = {
  [SEARCH_API_REGISTRY_TOOL]: async (args, ctx) => {
    const r = runRegistrySearch(ctx.registry, args);
    return r.ok ? jsonToolResult(r.data, false) : toolError(r.error);
  },

  [SEARCH_BUSINESS_DATA_TOOL]: async (args, ctx) => {
    const query = typeof args.query === 'string' ? args.query : '';
    if (!query.trim()) return toolError('search_business_data requires a non-empty "query".');
    const r = await ctx.transport.send(buildSearchBusinessDataRequest(args, ctx.searchPath ?? DEFAULT_SEARCH_PATH), {
      actAsUserId: ctx.actAsUserId,
    });
    // Unlike call_api_endpoint, the search result is the bare upstream body.
    return jsonToolResult(upstreamBodyData(r.body), !r.ok, r.status);
  },

  [CALL_API_ENDPOINT_TOOL]: async (args, ctx) => {
    const entryId = args.entryId;
    if (!entryId || typeof entryId !== 'string') {
      return toolError('call_api_endpoint requires "entryId" (use search_api_registry first).');
    }
    const entry = resolveRegistryEntry(ctx.registry, entryId);
    if (!entry) return toolError(`No registry entry found for entryId "${entryId}".`);
    return sendAsJson(ctx, buildRequest(entry, args as CallEndpointArgs), { actAsUserId: ctx.actAsUserId });
  },

  [ATTACH_FILE_TOOL]: async (args, ctx) => {
    let built: BuiltRequest;
    try {
      built = buildAttachFileRequest(args);
    } catch (err) {
      // AttachFileInputError messages are written to never echo the signed URL.
      if (err instanceof AttachFileInputError) return toolError(err.message);
      throw err;
    }
    // attach_file never acts as another user (unchanged from before the dispatch table).
    return sendAsJson(ctx, built);
  },

  [READ_ATTACHMENT_TOOL]: async (args, ctx) => {
    let built: BuiltRequest;
    try {
      built = buildReadAttachmentRequest(args);
    } catch (err) {
      if (err instanceof ReadAttachmentInputError) return toolError(err.message);
      throw err;
    }
    const r = await ctx.transport.send(built, { actAsUserId: ctx.actAsUserId });
    return attachmentReadToToolResult(upstreamBodyData(r.body), r.status);
  },
};

/**
 * The single dispatch table behind both MCP servers (hosted `/api/mcp` and the
 * stdio connector). Each handler builds a request with a pure builder, sends it
 * through the caller's transport and maps the result to MCP content blocks.
 * Unexpected failures (a throwing builder or transport) propagate: the caller owns
 * the try/catch, audit and act-as wrapping.
 */
export async function dispatchMetaTool(
  name: string,
  args: Record<string, unknown>,
  ctx: MetaToolContext,
): Promise<ToolResult> {
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, name) ? HANDLERS[name] : undefined;
  if (!handler) return toolError(`Unknown tool: ${name}`);
  return handler(args, ctx);
}
