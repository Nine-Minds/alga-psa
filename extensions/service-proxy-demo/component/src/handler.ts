import { ExecuteRequest, ExecuteResponse, HttpHeader, jsonResponse, decodeUtf8 } from './runtime.js';
import { get as getSecret } from 'alga:extension/secrets';
import { fetch as httpFetch } from 'alga:extension/http';
import { logInfo, logWarn, logError } from 'alga:extension/logging';

async function safeLog(level: 'info' | 'warn' | 'error', message: string) {
  try {
    const text = String(message ?? '');
    if (level === 'info') {
      await logInfo(text);
    } else if (level === 'warn') {
      await logWarn(text);
    } else {
      await logError(text);
    }
  } catch {
    // logging failures should not abort execution
  }
}

interface TicketSummary {
  id: string;
  title: string;
  status: string;
  assignee?: string | null;
}

interface TicketApiResponse {
  tickets?: TicketSummary[];
  items?: TicketSummary[];
  data?: unknown;
}

function decodeBody(body?: Uint8Array | null): string {
  return decodeUtf8(body);
}

function selectTickets(payload: TicketApiResponse): TicketSummary[] {
  if (Array.isArray(payload.tickets)) return payload.tickets;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray((payload.data as any)?.tickets)) return (payload.data as any).tickets;
  return [];
}

function parseLimit(source: unknown, fallback = 10): number {
  const n = typeof source === 'string' ? Number.parseInt(source, 10) : Number(source);
  if (Number.isFinite(n) && n > 0 && n <= 100) return Math.floor(n);
  return fallback;
}

function parseProxyPayload(body?: Uint8Array | null): { limit?: number } {
  const text = decodeBody(body);
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (typeof value === 'object' && value && 'limit' in value) {
      return { limit: parseLimit((value as Record<string, unknown>).limit, 10) };
    }
  } catch {
    // ignore payload parse errors
  }
  return {};
}

async function fetchTickets(
  baseUrl: string,
  apiKey: string,
  limit: number,
  requestId: string | null | undefined,
): Promise<{ ok: boolean; tickets: TicketSummary[]; status: number; error?: string }> {
  const url = new URL('/api/v1/tickets', baseUrl);
  url.searchParams.set('limit', limit.toString());

  const headers: HttpHeader[] = [
    { name: 'accept', value: 'application/json' },
    { name: 'x-api-key', value: apiKey },
  ];
  if (requestId) {
    headers.push({ name: 'x-request-id', value: requestId });
  }

  const response = await httpFetch({
    method: 'GET',
    url: url.toString(),
    headers,
  });

  const text = decodeBody(response.body);
  if (response.status >= 200 && response.status < 300) {
    try {
      const json = text ? (JSON.parse(text) as TicketApiResponse) : {};
      const tickets = selectTickets(json);
      return { ok: true, tickets, status: response.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, tickets: [], status: response.status, error: `failed_to_parse_ticket_payload: ${message}` };
    }
  }

const errorMessage = text || `upstream returned status ${response.status}`;
return { ok: false, tickets: [], status: response.status, error: errorMessage };
}

const DEFAULT_API_BASE = 'http://host.docker.internal:3001';

function resolveApiBase(request: ExecuteRequest): string {
  const ctxConfig = (request as any)?.context?.config;
  if (ctxConfig && typeof ctxConfig === 'object' && ctxConfig.algaApiBase) {
    return String(ctxConfig.algaApiBase);
  }
  const headerMatch = request.http.headers?.find(
    (header) => header.name?.toLowerCase() === 'x-alga-api-base',
  );
  if (headerMatch?.value) {
    return headerMatch.value;
  }
  return DEFAULT_API_BASE;
}

export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  try {
    const url = request.http.url ?? request.http.path ?? '/';
    const isProxy = url.startsWith('/proxy/');
    const queryLimit = isProxy ? undefined : request.http.query?.limit;
    const { limit: proxyLimit } = isProxy ? parseProxyPayload(request.http.body) : { limit: undefined };
    const limit = proxyLimit ?? parseLimit(queryLimit, 10);

    await safeLog(
      'info',
      `[service-proxy-demo] handler start path=${url} proxy=${isProxy} limit=${limit} requestId=${request.context.requestId ?? 'n/a'}`,
    );

    let apiKey: string;
    try {
      apiKey = await getSecret('ALGA_API_KEY');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'unknown_error');
      await safeLog('error', `[service-proxy-demo] missing ALGA_API_KEY secret: ${message}`);
      return jsonResponse({ ok: false, error: 'missing_alga_api_key', detail: message || '(empty message)' }, { status: 500 });
    }

    const baseUrl = resolveApiBase(request);
    await safeLog('info', `[service-proxy-demo] resolved baseUrl=${baseUrl}`);
    const fetchResult = await fetchTickets(baseUrl, apiKey, limit, request.context.requestId).catch(
      async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        await safeLog('error', `[service-proxy-demo] http.fetch threw: ${message}`);
        return { ok: false, tickets: [], status: 502, error: message };
      },
    );

    if (!fetchResult.ok) {
      await safeLog(
        'warn',
        `[service-proxy-demo] ticket lookup failed: status=${fetchResult.status} error=${fetchResult.error ?? 'unknown'}`,
      );
    } else {
      await safeLog('info', `[service-proxy-demo] ticket lookup ok: status=${fetchResult.status} count=${fetchResult.tickets.length}`);
    }

    return jsonResponse(
      {
        ok: fetchResult.ok,
        tenantId: request.context.tenantId,
        extensionId: request.context.extensionId,
        tickets: fetchResult.tickets,
        upstreamStatus: fetchResult.status,
        error: fetchResult.error,
        limit,
        fromProxy: isProxy,
        fetchedAt: new Date().toISOString(),
      },
      { status: fetchResult.ok ? 200 : 502 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[service-proxy-demo] unhandled error: ${message}`);
    return jsonResponse({ ok: false, error: 'unhandled_error', message }, { status: 500 });
  }
}

export async function componentMetadata() {
  return {
    name: 'ServiceProxyDemo',
    capabilities: ['cap:context.read', 'cap:log.emit', 'cap:secrets.get', 'cap:http.fetch', 'cap:ui.proxy'],
  } as const;
}
