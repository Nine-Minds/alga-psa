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
  callRoute(route: string, payload?: Uint8Array | null): Promise<Uint8Array>;
  call?(route: string, payload?: Uint8Array | null): Promise<Uint8Array>;
}

// Scheduler Host API types

/** Information about a scheduled task */
export interface ScheduleInfo {
  /** Unique schedule identifier */
  id: string;
  /** API endpoint path (e.g., "/sync") */
  endpointPath: string;
  /** HTTP method (GET or POST) */
  endpointMethod: string;
  /** Optional human-readable name */
  name?: string | null;
  /** Cron expression (5-field standard) */
  cron: string;
  /** IANA timezone (e.g., "America/New_York") */
  timezone: string;
  /** Whether the schedule is active */
  enabled: boolean;
  /** Optional JSON payload sent with each invocation */
  payload?: unknown;
  /** ISO timestamp of last execution */
  lastRunAt?: string | null;
  /** Status of last execution (success, failure, etc.) */
  lastRunStatus?: string | null;
  /** Error message from last failed execution */
  lastError?: string | null;
  /** ISO timestamp when schedule was created */
  createdAt?: string | null;
}

/** Information about an API endpoint that can be scheduled */
export interface EndpointInfo {
  /** Unique endpoint identifier */
  id: string;
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Endpoint path (e.g., "/sync") */
  path: string;
  /** Handler function name */
  handler: string;
  /** Whether this endpoint can be scheduled (no path params, GET/POST only) */
  schedulable: boolean;
}

/** Input for creating a new schedule */
export interface CreateScheduleInput {
  /** Endpoint path to invoke (e.g., "/sync") */
  endpoint: string;
  /** Cron expression (5-field: minute hour day-of-month month day-of-week) */
  cron: string;
  /** IANA timezone (defaults to UTC) */
  timezone?: string;
  /** Whether schedule is active (defaults to true) */
  enabled?: boolean;
  /** Optional human-readable name */
  name?: string;
  /** Optional JSON payload for each invocation */
  payload?: unknown;
}

/** Result of creating a schedule */
export interface CreateScheduleResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Schedule ID if created successfully */
  scheduleId?: string;
  /** Error message if failed */
  error?: string;
  /** Field-level validation errors */
  fieldErrors?: Record<string, string>;
}

/** Input for updating an existing schedule */
export interface UpdateScheduleInput {
  /** New endpoint path (optional) */
  endpoint?: string;
  /** New cron expression (optional) */
  cron?: string;
  /** New timezone (optional) */
  timezone?: string;
  /** New enabled state (optional) */
  enabled?: boolean;
  /** New name (optional, null to clear) */
  name?: string | null;
  /** New payload (optional, null to clear) */
  payload?: unknown | null;
}

/** Result of updating a schedule */
export interface UpdateScheduleResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Field-level validation errors */
  fieldErrors?: Record<string, string>;
}

/** Result of deleting a schedule */
export interface DeleteScheduleResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/** Host API for managing scheduled tasks */
export interface SchedulerHost {
  /** List all schedules for this extension install */
  list(): Promise<ScheduleInfo[]>;
  /** Get a specific schedule by ID */
  get(scheduleId: string): Promise<ScheduleInfo | null>;
  /** Create a new schedule */
  create(input: CreateScheduleInput): Promise<CreateScheduleResult>;
  /** Update an existing schedule */
  update(scheduleId: string, input: UpdateScheduleInput): Promise<UpdateScheduleResult>;
  /** Delete a schedule */
  delete(scheduleId: string): Promise<DeleteScheduleResult>;
  /** List available endpoints that can be scheduled */
  getEndpoints(): Promise<EndpointInfo[]>;
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
  /** Scheduler API for managing scheduled tasks (requires cap:scheduler.manage) */
  scheduler: SchedulerHost;
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
      async callRoute() {
        throw new Error('mock uiProxy.callRoute not implemented');
      },
      async call() {
        throw new Error('mock uiProxy.call not implemented');
      },
    },
    scheduler: {
      async list() {
        return [];
      },
      async get() {
        return null;
      },
      async create() {
        throw new Error('mock scheduler.create not implemented');
      },
      async update() {
        throw new Error('mock scheduler.update not implemented');
      },
      async delete() {
        throw new Error('mock scheduler.delete not implemented');
      },
      async getEndpoints() {
        return [];
      },
    },
  };

  const mergedUiProxy: UiProxyHost = {
    ...defaultBindings.uiProxy,
    ...overrides.uiProxy,
  };
  if (!mergedUiProxy.callRoute && mergedUiProxy.call) {
    mergedUiProxy.callRoute = mergedUiProxy.call.bind(mergedUiProxy);
  }
  if (!mergedUiProxy.call && mergedUiProxy.callRoute) {
    mergedUiProxy.call = mergedUiProxy.callRoute.bind(mergedUiProxy);
  }

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
    uiProxy: mergedUiProxy,
    scheduler: {
      ...defaultBindings.scheduler,
      ...overrides.scheduler,
    },
  };
}

export { callProxyJson } from './ui.js';
