const encoder = new TextEncoder();

export interface ContextData {
  requestId?: string | null;
  tenantId: string;
  extensionId: string;
  installId?: string | null;
  versionId?: string | null;
  config?: Record<string, string>;
}

export interface HttpHeader {
  name: string;
  value: string;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: HttpHeader[];
  body?: Uint8Array | null;
}

export interface HttpResponse {
  status: number;
  headers: HttpHeader[];
  body?: Uint8Array | null;
}

export interface ExecuteRequest {
  context: ContextData;
  http: HttpRequest;
}

export interface ExecuteResponse {
  status: number;
  headers?: HttpHeader[];
  body?: Uint8Array | null;
}

export interface SecretsHost {
  get(key: string): Promise<string>;
  list(): Promise<string[]>;
}

export interface HttpHost {
  fetch(request: HttpRequest): Promise<HttpResponse>;
}

export interface StorageHost {
  get(namespace: string, key: string): Promise<Uint8Array | null>;
  put(entry: { namespace: string; key: string; value: Uint8Array; revision?: number | null }): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string): Promise<Array<{ key: string; value: Uint8Array; revision?: number | null }>>;
}

export interface LoggingHost {
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string): Promise<void>;
}

export interface UiProxyHost {
  call(route: string, payload?: Uint8Array | null): Promise<Uint8Array>;
}

export interface HostBindings {
  context: {
    get(): Promise<ContextData>;
  };
  secrets: SecretsHost;
  http: HttpHost;
  storage: StorageHost;
  logging: LoggingHost;
  uiProxy: UiProxyHost;
}

export type Handler = (request: ExecuteRequest, host: HostBindings) => Promise<ExecuteResponse> | ExecuteResponse;

export function jsonResponse(body: unknown, init: Partial<ExecuteResponse> = {}): ExecuteResponse {
  const encoded = body instanceof Uint8Array ? body : encoder.encode(JSON.stringify(body));
  return {
    status: init.status ?? 200,
    headers: init.headers ?? [{ name: 'content-type', value: 'application/json' }],
    body: encoded,
  };
}

export function emptyResponse(status = 204): ExecuteResponse {
  return { status, headers: [], body: null };
}

export function createMockHostBindings(overrides: Partial<HostBindings> = {}): HostBindings {
  const noop = async () => {};
  const defaultBindings: HostBindings = {
    context: {
      async get() {
        return {
          tenantId: 'tenant-mock',
          extensionId: 'extension-mock',
          requestId: 'req-mock',
        };
      },
    },
    secrets: {
      async get() {
        throw new Error('mock secrets.get not implemented');
      },
      async list() {
        return [];
      },
    },
    http: {
      async fetch() {
        throw new Error('mock http.fetch not implemented');
      },
    },
    storage: {
      async get() { return null; },
      async put() { /* no-op */ },
      async delete() { /* no-op */ },
      async list() { return []; },
    },
    logging: {
      info: async (msg: string) => { console.info('[mock logging]', msg); },
      warn: async (msg: string) => { console.warn('[mock logging]', msg); },
      error: async (msg: string) => { console.error('[mock logging]', msg); },
    },
    uiProxy: {
      async call() {
        throw new Error('mock uiProxy.call not implemented');
      },
    },
  };

  return {
    ...defaultBindings,
    ...overrides,
    context: {
      ...defaultBindings.context,
      ...overrides.context,
    },
    secrets: {
      ...defaultBindings.secrets,
      ...overrides.secrets,
    },
    http: {
      ...defaultBindings.http,
      ...overrides.http,
    },
    storage: {
      ...defaultBindings.storage,
      ...overrides.storage,
    },
    logging: {
      ...defaultBindings.logging,
      ...overrides.logging,
    },
    uiProxy: {
      ...defaultBindings.uiProxy,
      ...overrides.uiProxy,
    },
  };
}

export { callProxyJson } from './ui.js';
