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
  await host.logging.info(`[Backend] Entering fetchTickets for requestId: ${requestId}, baseUrl: ${baseUrl}, limit: ${limit}`);
  const url = new URL('/api/tickets', baseUrl);
  url.searchParams.set('limit', limit.toString());

  const headers: HttpHeader[] = [
    { name: 'accept', value: 'application/json' },
    { name: 'authorization', value: `Bearer ${apiKey}` },
  ];
  if (requestId) {
    headers.push({ name: 'x-request-id', value: requestId });
  }

  await host.logging.info(`[Backend] Making HTTP fetch to: ${url.toString()}`);
  const response = await host.http.fetch({
    method: 'GET',
    url: url.toString(),
    headers,
  });
  await host.logging.info(`[Backend] Received HTTP fetch response with status: ${response.status}`);

  const text = decodeBody(response.body);
  if (response.status >= 200 && response.status < 300) {
    try {
      const json = text ? (JSON.parse(text) as TicketApiResponse) : {};
      const tickets = selectTickets(json);
      await host.logging.info(`[Backend] Successfully parsed tickets: ${tickets.length} items`);
      return { ok: true, tickets, status: response.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await host.logging.error(`[Backend] Failed to parse ticket payload: ${message}`);
      return { ok: false, tickets: [], status: response.status, error: `failed_to_parse_ticket_payload: ${message}` };
    }
  }

  const errorMessage = text || `upstream returned status ${response.status}`;
  await host.logging.warn(`[Backend] Upstream HTTP fetch failed: ${errorMessage}`);
  return { ok: false, tickets: [], status: response.status, error: errorMessage };
}

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await host.logging.info(`[Backend] Entering handler for request_id: ${request.context.request_id}, path: ${request.http.path}`);
  const url = request.http.url ?? request.http.path ?? '/';
  const isProxy = url.startsWith('/proxy/');
  const queryLimit = isProxy ? undefined : request.http.query?.limit;
  const { limit: proxyLimit } = isProxy ? parseProxyPayload(request.http.body) : { limit: undefined };
  const limit = proxyLimit ?? parseLimit(queryLimit, 10);
  await host.logging.info(`[Backend] Determined limit: ${limit}, isProxy: ${isProxy}`);

  let apiKey: string;
  try {
    await host.logging.info(`[Backend] Attempting to retrieve ALGA_API_KEY secret.`);
    apiKey = await host.secrets.get('ALGA_API_KEY');
    await host.logging.info(`[Backend] Successfully retrieved ALGA_API_KEY secret.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await host.logging.error(`[service-proxy-demo] missing ALGA_API_KEY secret: ${message}`);
    return jsonResponse({ ok: false, error: 'missing_alga_api_key' }, { status: 500 });
  }

  const baseUrl = request.context.config?.algaApiBase ?? 'https://api.alga-psa.local';
  await host.logging.info(`[Backend] Using base URL for API calls: ${baseUrl}`);
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
  await host.logging.info(`[Backend] Handler finished for request_id: ${request.context.request_id}. Result OK: ${fetchResult.ok}`);

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
