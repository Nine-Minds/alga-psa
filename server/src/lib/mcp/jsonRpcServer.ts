import { NextRequest, NextResponse } from 'next/server';
import {
  searchRegistryEntries,
  buildRequest,
  buildMetaToolDefinitions,
  SEARCH_API_REGISTRY_TOOL,
  SEARCH_BUSINESS_DATA_TOOL,
  CALL_API_ENDPOINT_TOOL,
  type ChatApiRegistryEntry,
  type CallEndpointArgs,
} from '@alga-psa/agent-tooling';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { loadMcpRegistry } from './loadRegistry';

// Minimal Streamable-HTTP MCP server. Handles JSON-RPC over POST with single
// application/json responses (sufficient for initialize / tools/list /
// tools/call). Reuses the shared agent-tooling engine.
//
// AUTH (MVP): validates an Alga API key (x-api-key / Bearer) and dispatches
// tool calls against /api/v1 under that key. The Phase-2 design replaces this
// with OAuth 2.1 + a tenant-IdP-bound agent identity dispatched in-process
// through the authorization kernel (see docs/plans/.../design.md §10).

const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface DispatchCtx {
  registry: ChatApiRegistryEntry[];
  apiKey: string;
  baseUrl: string;
}

interface ToolOutcome {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
}

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

const textContent = (data: unknown): Array<{ type: 'text'; text: string }> => [
  { type: 'text', text: JSON.stringify(data ?? null, null, 2) },
];
const toolOk = (data: unknown): ToolOutcome => ({ content: textContent(data), isError: false });
const toolErr = (message: string): ToolOutcome => ({ content: textContent({ error: message }), isError: true });

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.floor(n), max));
}

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}

function resolveEntry(registry: ChatApiRegistryEntry[], entryId: unknown): ChatApiRegistryEntry | null {
  const want = String(entryId ?? '').replace(/-/g, '_');
  if (!want) return null;
  return registry.find((e) => e.id.replace(/-/g, '_') === want) ?? null;
}

async function selfFetch(
  baseUrl: string,
  path: string,
  init: RequestInit,
  apiKey: string,
): Promise<{ status: number; ok: boolean; data: unknown }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>), 'x-api-key': apiKey };
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await res.text().catch(() => '');
  let data: unknown = text;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, ok: res.ok, data };
}

async function dispatchTool(name: string, args: Record<string, unknown>, ctx: DispatchCtx): Promise<ToolOutcome> {
  if (name === SEARCH_API_REGISTRY_TOOL) {
    const query = typeof args.query === 'string' ? args.query : '';
    if (!query.trim()) return toolErr('search_api_registry requires a non-empty "query".');
    const limit = clampInt(args.limit, 5, 1, 25);
    const results = searchRegistryEntries(ctx.registry, query, limit).map((r) => ({
      entryId: r.entry.id,
      displayName: r.entry.displayName,
      method: r.entry.method.toUpperCase(),
      path: r.entry.path,
      summary: r.entry.summary,
      parameters: r.entry.parameters,
      approvalRequired: r.entry.approvalRequired,
      score: Number(r.score.toFixed(2)),
    }));
    return toolOk({ query, count: results.length, results });
  }

  if (name === SEARCH_BUSINESS_DATA_TOOL) {
    const query = typeof args.query === 'string' ? args.query : '';
    if (!query.trim()) return toolErr('search_business_data requires a non-empty "query".');
    const params = new URLSearchParams();
    params.set('query', query);
    if (Array.isArray(args.types) && args.types.length > 0) params.set('types', args.types.map(String).join(','));
    if (args.limit !== undefined && args.limit !== null) params.set('limit', String(args.limit));
    if (args.cursor) params.set('cursor', String(args.cursor));
    if (args.sort) params.set('sort', String(args.sort));
    const r = await selfFetch(ctx.baseUrl, `/api/v1/search?${params.toString()}`, { method: 'GET' }, ctx.apiKey);
    return { content: textContent(r.data), isError: !r.ok };
  }

  if (name === CALL_API_ENDPOINT_TOOL) {
    const entryId = args.entryId;
    if (!entryId || typeof entryId !== 'string') {
      return toolErr('call_api_endpoint requires "entryId" (use search_api_registry first).');
    }
    const entry = resolveEntry(ctx.registry, entryId);
    if (!entry) return toolErr(`No registry entry found for entryId "${entryId}".`);
    const built = buildRequest(entry, args as CallEndpointArgs);
    const qs = new URLSearchParams(built.query).toString();
    const path = built.path + (qs ? `?${qs}` : '');
    const init: RequestInit = { method: built.method, headers: { ...built.headers } };
    if (built.body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = built.body;
    }
    const r = await selfFetch(ctx.baseUrl, path, init, ctx.apiKey);
    return { content: textContent({ status: r.status, ok: r.ok, data: r.data }), isError: !r.ok };
  }

  return toolErr(`Unknown tool: ${name}`);
}

async function handleOne(m: JsonRpcMessage, ctx: DispatchCtx): Promise<object | null> {
  const id = m?.id ?? null;
  switch (m?.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: (m.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'alga-psa', version: '0.1.0' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // notifications get no response
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: buildMetaToolDefinitions({ edition: 'ce' }) });
    case 'tools/call': {
      const name = (m.params?.name as string) ?? '';
      const args = (m.params?.arguments as Record<string, unknown>) ?? {};
      const out = await dispatchTool(name, args, ctx);
      return rpcResult(id, out);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${m?.method}`);
  }
}

export async function handleMcpJsonRpc(req: NextRequest): Promise<NextResponse> {
  const apiKey = req.headers.get('x-api-key') ?? bearerToken(req.headers.get('authorization'));
  if (!apiKey) {
    return new NextResponse(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${req.nextUrl.origin}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
  if (!keyRecord) {
    return NextResponse.json({ error: 'Invalid or expired API key' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  const messages = Array.isArray(body) ? (body as JsonRpcMessage[]) : [body as JsonRpcMessage];
  const { entries } = await loadMcpRegistry();
  const ctx: DispatchCtx = { registry: entries, apiKey, baseUrl: req.nextUrl.origin };

  const responses: object[] = [];
  for (const m of messages) {
    const r = await handleOne(m, ctx);
    if (r) responses.push(r);
  }

  if (responses.length === 0) {
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}
