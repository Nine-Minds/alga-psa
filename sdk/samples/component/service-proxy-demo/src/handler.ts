import {
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
  HttpHeader,
  jsonResponse,
} from '@alga/extension-runtime';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  if (!body || body.length === 0) {
    return '';
  }
  return decoder.decode(body);
}

function selectTickets(payload: TicketApiResponse): TicketSummary[] {
  if (Array.isArray(payload.tickets)) return payload.tickets;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray((payload.data as any)?.tickets)) return (payload.data as any).tickets;
  return [];
}

function parseLimit(source: unknown, fallback = 10): number {
  const n = typeof source === 'string' ? Number.parseInt(source, 10) : Number(source);
  if (Number.isFinite(n) && n > 0 && n <= 100) {
    return Math.floor(n);
  }
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
  } catch (err) {
    // fall through — payload parsing errors should not throw
  }
  return {};
}

async function fetchTickets(
  host: HostBindings,
  baseUrl: string,
  apiKey: string,
  limit: number,
  requestId: string | null | undefined,
): Promise<{ ok: boolean; tickets: TicketSummary[]; status: number; error?: string }> {
  const url = new URL('/api/tickets', baseUrl);
  url.searchParams.set('limit', limit.toString());

  const headers: HttpHeader[] = [
    { name: 'accept', value: 'application/json' },
    { name: 'authorization', value: `Bearer ${apiKey}` },
  ];
  if (requestId) {
    headers.push({ name: 'x-request-id', value: requestId });
  }

  const response = await host.http.fetch({
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

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const url = request.http.url ?? '/';
  const isProxy = url.startsWith('/proxy/');

  // Parse query parameters from URL
  let queryLimit: string | undefined;
  if (!isProxy) {
    try {
      const urlObj = new URL(url, 'http://localhost');
      queryLimit = urlObj.searchParams.get('limit') ?? undefined;
    } catch {
      // URL parsing failed, ignore
    }
  }

  const { limit: proxyLimit } = isProxy ? parseProxyPayload(request.http.body) : { limit: undefined };
  const limit = proxyLimit ?? parseLimit(queryLimit, 10);

  let apiKey: string;
  try {
    apiKey = await host.secrets.get('ALGA_API_KEY');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await host.logging.error(`[service-proxy-demo] missing ALGA_API_KEY secret: ${message}`);
    return jsonResponse({ ok: false, error: 'missing_alga_api_key' }, { status: 500 });
  }

  const baseUrl = request.context.config?.algaApiBase ?? 'https://api.alga-psa.local';
  const fetchResult = await fetchTickets(host, baseUrl, apiKey, limit, request.context.requestId)
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      await host.logging.error(`[service-proxy-demo] http.fetch threw: ${message}`);
      return { ok: false, tickets: [], status: 502, error: message };
    });

  if (!fetchResult.ok) {
    await host.logging.warn(
      `[service-proxy-demo] ticket lookup failed: status=${fetchResult.status} error=${fetchResult.error ?? 'unknown'}`,
    );
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
}

export async function componentMetadata() {
  return {
    name: 'ServiceProxyDemo',
    capabilities: ['cap:context.read', 'cap:log.emit', 'cap:secrets.get', 'cap:http.fetch', 'cap:ui.proxy'],
  } as const;
}
