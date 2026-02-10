import type { IframeBridge } from './bridge';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type HandlerMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface UiProxyHostLike {
  callRoute(route: string, payload?: Uint8Array | null): Promise<Uint8Array>;
  call?(route: string, payload?: Uint8Array | null): Promise<Uint8Array>;
}

export interface CallHandlerJsonOptions<TBody = unknown> {
  method?: HandlerMethod;
  body?: TBody;
}

type BridgeOrProxy = Pick<IframeBridge, 'uiProxy'> | UiProxyHostLike;

function resolveUiProxy(target: BridgeOrProxy): UiProxyHostLike {
  const maybeBridge = target as Pick<IframeBridge, 'uiProxy'>;
  if (maybeBridge.uiProxy) return maybeBridge.uiProxy;
  return target as UiProxyHostLike;
}

function appendMethodOverride(path: string, method: Exclude<HandlerMethod, 'POST'>): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}__method=${encodeURIComponent(method)}`;
}

function applyBodyMethodOverride<TBody>(method: Exclude<HandlerMethod, 'POST'>, body: TBody | undefined): unknown {
  if (body === undefined) return { __method: method };
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { __method: method, ...(body as Record<string, unknown>) };
  }
  return body;
}

function parseMethod(method?: string): HandlerMethod {
  const normalized = (method ?? 'GET').toUpperCase();
  if (
    normalized === 'GET' ||
    normalized === 'POST' ||
    normalized === 'PUT' ||
    normalized === 'PATCH' ||
    normalized === 'DELETE'
  ) {
    return normalized;
  }
  throw new Error(`Unsupported method: ${method}`);
}

/**
 * Canonical helper for extension UIs to call their own handlers through uiProxy.
 *
 * Notes:
 * - Uses JSON request/response payloads.
 * - Non-POST methods are transported via POST-compatible override:
 *   route query `?__method=...` and JSON body `{"__method":"..."}`.
 */
export async function callHandlerJson<TResponse = unknown, TBody = unknown>(
  bridgeOrProxy: BridgeOrProxy,
  path: string,
  options: CallHandlerJsonOptions<TBody> = {},
): Promise<TResponse | null> {
  const method = parseMethod(options.method);
  const uiProxy = resolveUiProxy(bridgeOrProxy);
  const call = uiProxy.callRoute ?? uiProxy.call;
  if (!call) {
    throw new Error('uiProxy host does not implement callRoute');
  }

  if (method === 'GET' && typeof options.body !== 'undefined') {
    throw new Error('GET requests cannot include a body');
  }

  let route = path;
  let body: unknown = options.body;

  if (method !== 'POST') {
    route = appendMethodOverride(path, method);
    body = applyBodyMethodOverride(method, options.body);
  }

  const payload =
    typeof body === 'undefined' ? undefined : encoder.encode(JSON.stringify(body));

  const responseBytes = await call.call(uiProxy, route, payload ?? undefined);
  const text = decoder.decode(responseBytes);
  return text.length ? (JSON.parse(text) as TResponse) : null;
}
