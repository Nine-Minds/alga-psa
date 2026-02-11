import type { IframeBridge } from '@alga-psa/extension-iframe-sdk';
import * as IframeSdk from '@alga-psa/extension-iframe-sdk';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type HandlerMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface CallHandlerJsonOptions<TBody = unknown> {
  method?: HandlerMethod;
  body?: TBody;
}

type CallHandlerJsonFn = <TResponse = unknown, TBody = unknown>(
  bridge: IframeBridge,
  path: string,
  options?: CallHandlerJsonOptions<TBody>,
) => Promise<TResponse | null>;

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

function appendMethodOverride(path: string, method: Exclude<HandlerMethod, 'POST'>): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}__method=${encodeURIComponent(method)}`;
}

function applyBodyMethodOverride<TBody>(
  method: Exclude<HandlerMethod, 'POST'>,
  body: TBody | undefined,
): unknown {
  if (body === undefined) return { __method: method };
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { __method: method, ...(body as Record<string, unknown>) };
  }
  return body;
}

// Prefer SDK-native helper when available (future releases),
// with a transport-compatible shim for currently published builds.
const sdkExports = IframeSdk as unknown as Record<string, unknown>;
const sdkCallHandlerJson = sdkExports['callHandlerJson'] as CallHandlerJsonFn | undefined;

const fallbackCallHandlerJson: CallHandlerJsonFn = async <TResponse = unknown, TBody = unknown>(
  bridge: IframeBridge,
  path: string,
  options: CallHandlerJsonOptions<TBody> = {},
) => {
  const method = parseMethod(options.method);
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
  const responseBytes = await bridge.uiProxy.callRoute(route, payload ?? undefined);
  const text = decoder.decode(responseBytes);
  return text.length ? (JSON.parse(text) as TResponse) : null;
};

export const callHandlerJson: CallHandlerJsonFn = sdkCallHandlerJson ?? fallbackCallHandlerJson;
