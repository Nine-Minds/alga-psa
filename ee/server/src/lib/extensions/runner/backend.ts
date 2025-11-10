import { filterResponseHeaders, Method } from '../lib/gateway-utils';

export type RunnerBackendKind = 'knative' | 'docker';

export interface RunnerExecutePayload {
  context: Record<string, unknown>;
  http: {
    method: Method;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body_b64?: string;
  };
  limits: { timeout_ms: number };
  endpoint?: string;
  providers?: unknown;
  secret_envelope?: unknown;
  [key: string]: unknown;
}

export interface RunnerExecuteOptions {
  requestId: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export interface RunnerExecuteResult {
  status: number;
  headers: Record<string, string>;
  body?: Buffer;
}

export interface RunnerFetchAssetOptions {
  path: string;
  search: string;
  method: string;
  headers: Headers;
}

export interface RunnerBackend {
  readonly kind: RunnerBackendKind;
  execute(payload: RunnerExecutePayload, options: RunnerExecuteOptions): Promise<RunnerExecuteResult>;
  fetchStaticAsset(options: RunnerFetchAssetOptions): Promise<Response>;
  getPublicBase(): string | null;
}

export class RunnerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerConfigError';
  }
}

export class RunnerRequestError extends Error {
  public readonly status?: number;
  public readonly backend: RunnerBackendKind;

  constructor(message: string, backend: RunnerBackendKind, status?: number) {
    super(message);
    this.name = 'RunnerRequestError';
    this.backend = backend;
    this.status = status;
  }
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const STATIC_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'if-modified-since',
  'if-none-match',
  'range',
  'user-agent',
]);

class HttpRunnerBackend implements RunnerBackend {
  public readonly kind: RunnerBackendKind;
  private readonly baseUrl: string;
  private readonly publicBase: string | null;
  private readonly serviceToken: string | null;

  constructor(kind: RunnerBackendKind, baseUrl: string, publicBase: string | null, serviceToken: string | null) {
    this.kind = kind;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.publicBase = publicBase ? trimTrailingSlashes(publicBase) : null;
    this.serviceToken = serviceToken;
  }

  getPublicBase(): string | null {
    return this.publicBase;
  }

  async execute(payload: RunnerExecutePayload, options: RunnerExecuteOptions): Promise<RunnerExecuteResult> {
    const endpoint = `${this.baseUrl}/v1/execute`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-request-id': options.requestId,
    };

    if (this.serviceToken) {
      headers['x-runner-service-token'] = this.serviceToken;
    }

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        if (value !== undefined && value !== null) {
          headers[key.toLowerCase()] = value;
        }
      }
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      throw wrapFetchError(error, this.kind);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => undefined);
      throw new RunnerRequestError(
        `Runner responded with non-success status ${response.status}${text ? `: ${text}` : ''}`,
        this.kind,
        response.status,
      );
    }

    const payloadJson: any = await response.json().catch((error) => {
      throw new RunnerRequestError(`Runner returned invalid JSON: ${(error as Error).message}`, this.kind);
    });

    const status = typeof payloadJson?.status === 'number' ? payloadJson.status : 200;
    const headersOut = filterResponseHeaders(payloadJson?.headers as Record<string, string | string[] | undefined> | undefined);
    const body = typeof payloadJson?.body_b64 === 'string'
      ? Buffer.from(payloadJson.body_b64, 'base64')
      : undefined;

    return { status, headers: headersOut, body };
  }

  async fetchStaticAsset(options: RunnerFetchAssetOptions): Promise<Response> {
    const url = buildUrlWithSearch(`${this.baseUrl}/${options.path}`.replace(/\/+$/, ''), options.search);
    const headers = new Headers();
    for (const [key, value] of options.headers.entries()) {
      const lower = key.toLowerCase();
      if (STATIC_HEADER_ALLOWLIST.has(lower)) {
        headers.set(lower, value);
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
      });
    } catch (error) {
      throw wrapFetchError(error, this.kind);
    }

    return response;
  }
}

function wrapFetchError(error: unknown, backend: RunnerBackendKind): Error {
  if (error instanceof RunnerRequestError || error instanceof RunnerConfigError) {
    return error;
  }
  if ((error as any)?.name === 'AbortError') {
    const err = new RunnerRequestError('Runner request timed out', backend);
    err.name = 'AbortError';
    return err;
  }
  return new RunnerRequestError((error as Error)?.message ?? 'Runner request failed', backend);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildUrlWithSearch(base: string, search: string): string {
  if (!search) {
    return base;
  }
  return `${base}${search.startsWith('?') ? search : `?${search}`}`;
}

let cachedBackend: RunnerBackend | null = null;

function resolveBackendKind(): RunnerBackendKind {
  const raw = (process.env.RUNNER_BACKEND || 'knative').trim().toLowerCase();
  return raw === 'docker' ? 'docker' : 'knative';
}

function resolveBaseUrl(kind: RunnerBackendKind): string {
  const base = kind === 'docker'
    ? process.env.RUNNER_DOCKER_HOST || process.env.RUNNER_BASE_URL
    : process.env.RUNNER_BASE_URL;

  if (!base) {
    throw new RunnerConfigError(`Runner base URL not configured for backend "${kind}"`);
  }
  return base.replace(/\/+$/, '');
}

function resolvePublicBase(): string | null {
  const raw = process.env.RUNNER_PUBLIC_BASE;
  if (!raw) return null;
  return trimTrailingSlashes(raw);
}

function resolveServiceToken(): string | null {
  return process.env.RUNNER_SERVICE_TOKEN || null;
}

export function getRunnerBackend(): RunnerBackend {
  if (process.env.NODE_ENV === 'development') {
    return buildBackend();
  }
  if (!cachedBackend) {
    cachedBackend = buildBackend();
  }
  return cachedBackend;
}

function buildBackend(): RunnerBackend {
  const kind = resolveBackendKind();
  const base = resolveBaseUrl(kind);
  const publicBase = resolvePublicBase();
  const serviceToken = resolveServiceToken();
  return new HttpRunnerBackend(kind, base, publicBase, serviceToken);
}

export function filterHopByHopHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(lower)) {
      out[lower] = value;
    }
  });
  return out;
}
