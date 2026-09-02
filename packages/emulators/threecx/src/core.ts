import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';
import {
  THREECX_QUERY_PARAMS,
  THREECX_ROUTE_SEGMENTS,
  threecxRouteUrl,
} from '@alga-psa/ee-threecx/lib/routeConstants';

export interface ThreecxTarget {
  baseUrl: string;
  tenantSlug: string;
  apiKey: string;
}

export interface ThreecxExchange {
  action: string;
  request: { method: string; path: string; url: string; body?: unknown };
  response: { status: number; body: unknown };
}

export interface ThreecxInboundCallInput {
  number: string;
  agentEmail: string;
  agentExtension?: string;
  answered?: boolean;
  durationSeconds?: number;
}

type FetchImpl = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

function redactKey(value: string): string {
  if (!value) return '';
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

/**
 * A stand-in for the 3CX CRM engine: it dials the AlgaPSA server's 3CX routes
 * exactly as the real engine would (GET lookup, then POST report-call, both
 * with the bearer key), and records every request/response pair so a test can
 * assert the whole loop without a real PBX. All URLs come from the shared route
 * constants, so a route rename moves the emulator too.
 */
export class ThreecxEmulatorCore implements EmulatorCore {
  private target: ThreecxTarget = { baseUrl: '', tenantSlug: '', apiKey: '' };
  readonly exchanges: ThreecxExchange[] = [];
  /** Injectable so unit tests can drive the loop without a live server. */
  fetchImpl: FetchImpl = (url, init) => (globalThis.fetch as unknown as FetchImpl)(url, init);

  constructor(private readonly env: HostEnv) {}

  reset(): void {
    this.target = { baseUrl: '', tenantSlug: '', apiKey: '' };
    this.exchanges.length = 0;
  }

  snapshot(): unknown {
    return { target: this.target };
  }

  restore(state: unknown): void {
    const t = (state as { target?: ThreecxTarget } | null)?.target;
    if (t) this.target = { ...this.target, ...t };
  }

  configure(input: Partial<ThreecxTarget>): ThreecxTarget {
    this.target = {
      baseUrl: input.baseUrl ?? this.target.baseUrl,
      tenantSlug: input.tenantSlug ?? this.target.tenantSlug,
      apiKey: input.apiKey ?? this.target.apiKey,
    };
    return this.redactedTarget();
  }

  redactedTarget(): ThreecxTarget {
    return {
      baseUrl: this.target.baseUrl,
      tenantSlug: this.target.tenantSlug,
      apiKey: redactKey(this.target.apiKey),
    };
  }

  private lookupUrl(number: string): string {
    const base = threecxRouteUrl(this.target.baseUrl, this.target.tenantSlug, THREECX_ROUTE_SEGMENTS.lookup);
    return `${base}?${THREECX_QUERY_PARAMS.number}=${encodeURIComponent(number)}`;
  }

  private searchUrl(q: string): string {
    const base = threecxRouteUrl(this.target.baseUrl, this.target.tenantSlug, THREECX_ROUTE_SEGMENTS.search);
    return `${base}?${THREECX_QUERY_PARAMS.q}=${encodeURIComponent(q)}`;
  }

  private reportUrl(): string {
    return threecxRouteUrl(this.target.baseUrl, this.target.tenantSlug, THREECX_ROUTE_SEGMENTS.reportCall);
  }

  private async send(
    action: string,
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ): Promise<ThreecxExchange> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.target.apiKey}` };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    let responseBody: unknown = null;
    try {
      responseBody = await res.json();
    } catch {
      responseBody = null;
    }

    const exchange: ThreecxExchange = {
      action,
      request: { method, path: new URL(url).pathname, url, ...(body !== undefined ? { body } : {}) },
      response: { status: res.status, body: responseBody },
    };
    this.exchanges.push(exchange);
    return exchange;
  }

  private reportBody(input: {
    callType: 'Inbound' | 'Outbound' | 'Missed' | 'Notanswered';
    number: string;
    agentEmail: string;
    agentExtension?: string;
    durationSeconds: number;
  }): Record<string, unknown> {
    const start = this.env.clock.now();
    const end = new Date(start.getTime() + input.durationSeconds * 1000);
    const missed = input.callType === 'Missed' || input.callType === 'Notanswered';
    return {
      callType: input.callType,
      number: input.number,
      agentExtension: input.agentExtension ?? '',
      agentEmail: input.agentEmail,
      queueExtension: '',
      durationSeconds: missed ? 0 : input.durationSeconds,
      startTimeUtc: start.toISOString(),
      establishedTimeUtc: missed ? '' : start.toISOString(),
      endTimeUtc: end.toISOString(),
    };
  }

  async crmInboundCall(input: ThreecxInboundCallInput): Promise<ThreecxExchange[]> {
    const answered = input.answered !== false;
    const lookup = await this.send('crm-inbound-call', 'GET', this.lookupUrl(input.number));
    const report = await this.send(
      'crm-inbound-call',
      'POST',
      this.reportUrl(),
      this.reportBody({
        callType: answered ? 'Inbound' : 'Missed',
        number: input.number,
        agentEmail: input.agentEmail,
        agentExtension: input.agentExtension,
        durationSeconds: answered ? input.durationSeconds ?? 0 : 0,
      }),
    );
    return [lookup, report];
  }

  async crmOutboundCall(input: ThreecxInboundCallInput): Promise<ThreecxExchange[]> {
    const lookup = await this.send('crm-outbound-call', 'GET', this.lookupUrl(input.number));
    const report = await this.send(
      'crm-outbound-call',
      'POST',
      this.reportUrl(),
      this.reportBody({
        callType: 'Outbound',
        number: input.number,
        agentEmail: input.agentEmail,
        agentExtension: input.agentExtension,
        durationSeconds: input.durationSeconds ?? 0,
      }),
    );
    return [lookup, report];
  }

  async crmSearch(q: string): Promise<ThreecxExchange> {
    return this.send('crm-search', 'GET', this.searchUrl(q));
  }
}
