import type { IframeBridge } from './bridge';
import type { ProxyHttpMethod } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type HandlerMethod = ProxyHttpMethod;

export interface UiProxyCallOptions {
  method?: HandlerMethod;
}

export interface UiProxyHostLike {
  callRoute(route: string, payload?: Uint8Array | null, options?: UiProxyCallOptions): Promise<Uint8Array>;
  call?(route: string, payload?: Uint8Array | null, options?: UiProxyCallOptions): Promise<Uint8Array>;
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
 * - Methods are forwarded to the host bridge via uiProxy call options.
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

  const body: unknown = options.body;
  const payload =
    typeof body === 'undefined' ? undefined : encoder.encode(JSON.stringify(body));

  const responseBytes = await call.call(uiProxy, path, payload ?? undefined, { method });
  const text = decoder.decode(responseBytes);
  return text.length ? (JSON.parse(text) as TResponse) : null;
}
