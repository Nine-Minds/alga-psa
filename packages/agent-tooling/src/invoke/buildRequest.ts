import type { ChatApiRegistryEntry } from '../registry/schema';

/**
 * Arguments for invoking a registry endpoint. Mirrors the `call_api_endpoint`
 * tool input: dedicated `path`/`query`/`headers`/`body` bags, a generic
 * `parameters` bag, plus loose top-level keys as a last-resort fallback.
 */
export interface CallEndpointArgs {
  method?: string;
  path?: unknown;
  pathParams?: unknown;
  query?: unknown;
  headers?: unknown;
  body?: unknown;
  data?: unknown;
  payload?: unknown;
  parameters?: unknown;
  [key: string]: unknown;
}

/**
 * A transport-agnostic description of the HTTP request to make. Deliberately
 * carries NO auth/tenant headers and NO base URL — the caller (connector or
 * remote server) composes the absolute URL and adds its own credentials.
 */
export interface BuiltRequest {
  method: string;
  /** Path with `{params}` substituted; keeps its leading slash. */
  path: string;
  /** Resolved query params, stringified. */
  query: Record<string, string>;
  /** Header params + explicit headers (NO auth). */
  headers: Record<string, string>;
  /** Serialized request body, or undefined for bodyless requests. */
  body?: string;
  /** True for POST/PUT/PATCH/DELETE (anything not a safe read). */
  isMutation: boolean;
}

const READ_METHODS = new Set(['GET', 'HEAD']);

export function isMutationMethod(method: string): boolean {
  return !READ_METHODS.has(method.toUpperCase());
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * Build a concrete HTTP request from a registry entry + tool arguments.
 *
 * Faithful to the EE chat assistant's request construction (path-param
 * substitution with layered fallbacks, query/header collection, JSON body for
 * non-GET/DELETE), minus transport concerns. Fails fast on unresolved path
 * parameters per repo standards.
 */
export function buildRequest(
  entry: ChatApiRegistryEntry,
  rawArgs: CallEndpointArgs = {},
): BuiltRequest {
  const args = rawArgs ?? {};
  const requestedMethod = typeof args.method === 'string' ? args.method.toUpperCase() : undefined;
  const method = requestedMethod ?? entry.method.toUpperCase();
  let path = entry.path;

  const genericParameters = normalizeRecord(args.parameters);
  const pathParamsInput = normalizeRecord(args.path ?? args.pathParams ?? genericParameters.path ?? {});
  const queryInput = normalizeRecord(args.query ?? genericParameters.query ?? {});
  const headerInput = normalizeRecord(args.headers ?? genericParameters.headers ?? {});

  const headers: Record<string, string> = {};
  const queryParams: Record<string, unknown> = { ...queryInput };

  const directArgs = normalizeRecord(args);
  for (const key of ['body', 'data', 'payload', 'path', 'pathParams', 'query', 'headers', 'parameters', 'entryId', 'method']) {
    delete directArgs[key];
  }

  for (const param of entry.parameters ?? []) {
    if (param.in === 'path') {
      const value = pathParamsInput[param.name] ?? genericParameters[param.name] ?? directArgs[param.name];
      if (value !== undefined && value !== null) {
        path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
      }
    } else if (param.in === 'query') {
      const value = queryInput[param.name] ?? genericParameters[param.name] ?? directArgs[param.name];
      if (value !== undefined && value !== null) {
        queryParams[param.name] = value;
      }
    } else if (param.in === 'header') {
      const value = headerInput[param.name] ?? genericParameters[param.name] ?? directArgs[param.name];
      if (value !== undefined && value !== null) {
        headers[param.name] = String(value);
      }
    }
  }

  // Replace any remaining templated segments from the best available source.
  path = path.replace(/\{([^}]+)\}/g, (match, group: string) => {
    const fallback = typeof args[group] !== 'object' ? args[group] : undefined;
    const candidate = pathParamsInput[group] ?? genericParameters[group] ?? directArgs[group] ?? fallback;
    return candidate === undefined || candidate === null ? match : encodeURIComponent(String(candidate));
  });

  const unresolved = Array.from(path.matchAll(/\{([^}]+)\}/g), (m) => m[1]).filter(
    (segment): segment is string => typeof segment === 'string' && segment.length > 0,
  );
  if (unresolved.length > 0) {
    throw new Error(`Unresolved path parameters for ${entry.id}: ${unresolved.join(', ')}`);
  }

  // Include any explicit extra headers provided directly.
  for (const [key, value] of Object.entries(headerInput)) {
    if (value !== undefined && value !== null) {
      headers[key] = String(value);
    }
  }

  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      query[key] = String(value);
    }
  }

  let body: string | undefined;
  const bodyValue = args.body ?? args.data ?? args.payload ?? genericParameters.body ?? undefined;
  if (bodyValue !== undefined && method !== 'GET' && method !== 'DELETE') {
    body = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
  }

  return {
    method,
    path,
    query,
    headers,
    body,
    isMutation: isMutationMethod(method),
  };
}
