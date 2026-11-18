import { NextRequest, NextResponse } from 'next/server';
import {
  buildMetaToolDefinitions,
  CALL_API_ENDPOINT_TOOL,
  MCP_SERVER_INSTRUCTIONS,
  dispatchMetaTool,
  jsonToolResult,
  readResponseBody,
  redactToolArguments,
  type BuiltRequest,
  type ChatApiRegistryEntry,
  type MetaToolTransport,
  type ToolResult,
} from '@alga-psa/agent-tooling';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { loadMcpRegistry } from '@/lib/mcp/loadRegistry';
import { authenticateAgentToken, looksLikeJwt } from './idpToken';
import { mintAgentSessionKey } from './agents';
import { writeAgentAudit } from './agentAudit';
import { resolvePublicBaseUrl, resolveInternalBaseUrl } from './baseUrl';
import { looksLikeAlgaToken, verifyAccessToken } from './oauth/tokens';
import { isGrantActive } from './oauth/grants';
import { mintUserSessionKey } from './oauth/userSession';
import { isApiCredentialsRefusedError } from '@alga-psa/authorization/subject/principalKind';

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
  // When set, this is an agent session — tool calls are attributed + audited.
  agentId?: string;
  tenant?: string;
}

/** Header that makes a service-principal key act as a named user (PRD R5). */
const ACT_AS_HEADER = 'x-alga-act-as';

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}

/**
 * The hosted transport for `dispatchMetaTool`: sends a built request to this
 * instance's own /api/v1 under the session's key (and act-as header, when delegated).
 */
async function selfSend(
  baseUrl: string,
  built: BuiltRequest,
  apiKey: string,
  actAsUserId?: string | null,
): Promise<Awaited<ReturnType<MetaToolTransport['send']>>> {
  const qs = new URLSearchParams(built.query).toString();
  const headers: Record<string, string> = { ...built.headers };
  const init: RequestInit = { method: built.method };
  if (built.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = built.body;
  }
  headers['x-api-key'] = apiKey;
  if (actAsUserId) headers[ACT_AS_HEADER] = actAsUserId;
  const res = await fetch(`${baseUrl}${built.path}${qs ? `?${qs}` : ''}`, { ...init, headers });
  return { status: res.status, ok: res.ok, body: await readResponseBody(res) };
}

/** Only agent sessions may delegate; a plain API key never forwards the header. */
function actAsFromArgs(args: Record<string, unknown>, ctx: DispatchCtx): string | null {
  if (!ctx.agentId) return null;
  const value = args.act_as_user_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Adds the optional `actAsUserId` argument to the call tool, for agent sessions only. */
function withActAsArgument<T extends { name: string }>(tools: T[]): T[] {
  return tools.map((tool) => {
    if (tool.name !== CALL_API_ENDPOINT_TOOL) return tool;
    const t = tool as unknown as { description?: string; inputSchema?: { properties?: Record<string, unknown> } };
    return {
      ...tool,
      description: `${t.description ?? ''} Optional "act_as_user_id": run the call as that internal user (their permissions intersected with this agent's) when the agent is allowed to act as users. Human-owned work (time entries, approvals, public comments, bookings) without it fails with ACT_AS_REQUIRED.`.trim(),
      inputSchema: {
        ...t.inputSchema,
        properties: {
          ...(t.inputSchema?.properties ?? {}),
          act_as_user_id: { type: 'string', description: 'User id to act as. Requires act-as to be enabled for this agent.' },
        },
      },
    } as T;
  });
}

async function handleOne(m: JsonRpcMessage, ctx: DispatchCtx): Promise<object | null> {
  const id = m?.id ?? null;
  switch (m?.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: (m.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'alga-psa', version: '0.1.0' },
        instructions: MCP_SERVER_INSTRUCTIONS,
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // notifications get no response
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: withActAsArgument(buildMetaToolDefinitions({ edition: 'ce' })) });
    case 'tools/call': {
      const name = (m.params?.name as string) ?? '';
      const args = (m.params?.arguments as Record<string, unknown>) ?? {};
      // A transient dispatch failure (e.g. a self-fetch network error, or an
      // unresolved path param from buildRequest) must surface as a JSON-RPC
      // tool error — NOT bubble up and become a bare HTTP 500 that aborts the
      // whole MCP request. The MCP client can then see the error and retry.
      let out: ToolResult;
      try {
        const transport: MetaToolTransport = {
          send: (req, opts) => selfSend(ctx.baseUrl, req, ctx.apiKey, opts?.actAsUserId),
        };
        out = await dispatchMetaTool(name, args, {
          registry: ctx.registry,
          transport,
          actAsUserId: actAsFromArgs(args, ctx),
        });
      } catch (err) {
        out = jsonToolResult({ error: `Tool dispatch failed: ${err instanceof Error ? err.message : String(err)}` }, true);
      }
      if (ctx.agentId && ctx.tenant) {
        const decision = !out.isError
          ? 'allow'
          : out.statusCode === 403 || out.statusCode === 401
            ? 'deny'
            : 'error';
        // Audit is best-effort: a failed audit write must not 500 the tool call.
        try {
          await writeAgentAudit({
            tenant: ctx.tenant,
            agentId: ctx.agentId,
            tool: name,
            arguments: redactToolArguments(name, args),
            actAsUserId: actAsFromArgs(args, ctx),
            ok: !out.isError,
            statusCode: out.statusCode ?? null,
            decision,
            // The header is always content[0] (agent-tooling's header-first contract), so this is never base64.
            resultSummary: out.content?.[0]?.type === 'text' ? out.content[0].text : undefined,
          });
        } catch {
          // swallow — auditing is non-critical to returning the tool result
        }
      }
      return rpcResult(id, out);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${m?.method}`);
  }
}

interface ResolvedAuth {
  apiKey: string;
  agentId?: string;
  tenant?: string;
}

/**
 * Resolve the caller. Three credential shapes, in priority order:
 *  1. An AlgaPSA-issued MCP access token (`typ: at+jwt`) — the interactive OAuth
 *     path. Represents an Alga **user**; dispatched under a short-lived user key
 *     so the kernel enforces the user's own RBAC.
 *  2. An IdP-delegated **agent** JWT (legacy/unattended) — validated via the
 *     tenant's trusted IdP, dispatched under an agent-scoped key.
 *  3. An Alga **API key** (x-api-key or bearer).
 */
async function resolveAuth(
  req: NextRequest,
): Promise<{ ok: true; auth: ResolvedAuth } | { ok: false; status: number; error: string; wwwAuthenticate?: boolean }> {
  const xApiKey = req.headers.get('x-api-key');
  const bearer = bearerToken(req.headers.get('authorization'));

  // (1) AlgaPSA-issued user token from our own OAuth AS.
  if (bearer && looksLikeAlgaToken(bearer)) {
    const base = await resolvePublicBaseUrl(req);
    const claims = await verifyAccessToken({ token: bearer, base });
    if (!claims) return { ok: false, status: 401, error: 'Invalid or expired access token', wwwAuthenticate: true };
    if (!(await isGrantActive(claims.grantId))) {
      return { ok: false, status: 401, error: 'Authorization was revoked', wwwAuthenticate: true };
    }
    let sessionKey: string;
    try {
      sessionKey = await mintUserSessionKey({ tenant: claims.tenant, userId: claims.userId });
    } catch (error) {
      // A principal kind that holds no API credentials (a seat technician) has no MCP access, whatever grant
      // it holds. Refused here, before any tool is dispatched.
      if (isApiCredentialsRefusedError(error)) return { ok: false, status: 403, error: error.message };
      throw error;
    }
    return { ok: true, auth: { apiKey: sessionKey, tenant: claims.tenant } };
  }

  // (2) IdP-delegated agent JWT (legacy/unattended path — unchanged).
  if (bearer && looksLikeJwt(bearer)) {
    const res = await authenticateAgentToken(bearer);
    // Explicit `=== false` (not `!res.ok`): ee/server sets tsconfig strict:false, and
    // negative narrowing of a boolean-discriminated union doesn't narrow there.
    if (res.ok === false) return { ok: false, status: res.status, error: res.error };
    const { resolved } = res.ctx;
    let sessionKey: string;
    try {
      sessionKey = await mintAgentSessionKey({
        tenant: resolved.tenant,
        agentId: resolved.agent.agent_id,
        backingUserId: resolved.backingUserId as string,
      });
    } catch (error) {
      // A valid IdP token can outlive the tenant's Pro entitlement. Report the
      // expected denial at the authentication boundary, before any dispatch.
      if (error instanceof Error && 'code' in error && error.code === 'TIER_ACCESS_DENIED') {
        return { ok: false, status: 403, error: error.message };
      }
      // Name/code match, not instanceof: the class may cross a module seam.
      const err = error as { name?: string; message?: string };
      if ((err as { name?: string }).name === 'AgentInactiveError') {
        return { ok: false, status: 403, error: err.message ?? 'Agent is inactive' };
      }
      throw error;
    }
    return { ok: true, auth: { apiKey: sessionKey, agentId: resolved.agent.agent_id, tenant: resolved.tenant } };
  }

  const apiKey = xApiKey ?? bearer;
  if (!apiKey) return { ok: false, status: 401, error: 'Authentication required', wwwAuthenticate: true };
  const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
  if (!keyRecord) return { ok: false, status: 401, error: 'Invalid or expired API key' };
  return { ok: true, auth: { apiKey } };
}

export async function handleMcpJsonRpc(req: NextRequest): Promise<NextResponse> {
  const authResult = await resolveAuth(req);
  if (authResult.ok === false) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authResult.wwwAuthenticate) {
      // Public discovery pointer — external clients (e.g. claude.ai) chase this,
      // so it must be the public origin, not the internal upstream one.
      const publicBase = await resolvePublicBaseUrl(req);
      headers['WWW-Authenticate'] = `Bearer resource_metadata="${publicBase}/.well-known/oauth-protected-resource"`;
    }
    return new NextResponse(JSON.stringify({ error: authResult.error }), { status: authResult.status, headers });
  }
  const { auth } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  const messages = Array.isArray(body) ? (body as JsonRpcMessage[]) : [body as JsonRpcMessage];
  const { entries } = await loadMcpRegistry();
  const ctx: DispatchCtx = {
    registry: entries,
    apiKey: auth.apiKey,
    // In-pod loopback (plaintext HTTP), NOT the public origin — see
    // resolveInternalBaseUrl(). The public origin is only for OAuth discovery.
    baseUrl: resolveInternalBaseUrl(),
    agentId: auth.agentId,
    tenant: auth.tenant,
  };

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
