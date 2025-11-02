import { UiProxyHost } from './index.js';

export async function callProxyJson<T = unknown>(uiProxy: UiProxyHost, route: string, payload?: unknown): Promise<T> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const request = payload === undefined ? null : encoder.encode(JSON.stringify(payload));
  const call = uiProxy.callRoute ?? uiProxy.call;
  if (!call) {
    throw new Error('uiProxy host does not implement callRoute');
  }
  const response = await call.call(uiProxy, route, request ?? undefined);
  const text = decoder.decode(response);
  return text.length ? (JSON.parse(text) as T) : (undefined as unknown as T);
}
