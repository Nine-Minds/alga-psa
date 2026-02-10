import { describe, expect, it, vi } from 'vitest';

import { callHandlerJson, type UiProxyHostLike } from './ui-proxy';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function makeProxy(responseBody: unknown): UiProxyHostLike & { callRoute: ReturnType<typeof vi.fn> } {
  return {
    callRoute: vi.fn(async () => encoder.encode(JSON.stringify(responseBody))),
  };
}

function decodePayload(payload?: Uint8Array | null): unknown {
  if (!payload) return undefined;
  return JSON.parse(decoder.decode(payload));
}

describe('callHandlerJson', () => {
  it('defaults to GET with override payload', async () => {
    const proxy = makeProxy({ ok: true });

    const result = await callHandlerJson(proxy, '/api/status');

    expect(result).toEqual({ ok: true });
    expect(proxy.callRoute).toHaveBeenCalledTimes(1);
    const [route, payload] = proxy.callRoute.mock.calls[0];
    expect(route).toBe('/api/status?__method=GET');
    expect(decodePayload(payload)).toEqual({ __method: 'GET' });
  });

  it('sends POST body as JSON', async () => {
    const proxy = makeProxy({ created: true });

    const result = await callHandlerJson(proxy, '/api/items', {
      method: 'POST',
      body: { name: 'item-1' },
    });

    expect(result).toEqual({ created: true });
    expect(proxy.callRoute).toHaveBeenCalledTimes(1);
    const [route, payload] = proxy.callRoute.mock.calls[0];
    expect(route).toBe('/api/items');
    expect(decodePayload(payload)).toEqual({ name: 'item-1' });
  });

  it('encodes DELETE override in route and body', async () => {
    const proxy = makeProxy({ deleted: true });

    await callHandlerJson(proxy, '/api/items/42', { method: 'DELETE' });

    expect(proxy.callRoute).toHaveBeenCalledTimes(1);
    const [route, payload] = proxy.callRoute.mock.calls[0];
    expect(route).toBe('/api/items/42?__method=DELETE');
    expect(decodePayload(payload)).toEqual({ __method: 'DELETE' });
  });

  it('encodes PATCH override while preserving object body', async () => {
    const proxy = makeProxy({ updated: true });

    await callHandlerJson(proxy, '/api/items/42', {
      method: 'PATCH',
      body: { name: 'updated' },
    });

    expect(proxy.callRoute).toHaveBeenCalledTimes(1);
    const [route, payload] = proxy.callRoute.mock.calls[0];
    expect(route).toBe('/api/items/42?__method=PATCH');
    expect(decodePayload(payload)).toEqual({ __method: 'PATCH', name: 'updated' });
  });

  it('rejects GET with body', async () => {
    const proxy = makeProxy({ ok: true });

    await expect(
      callHandlerJson(proxy, '/api/items', { method: 'GET', body: { invalid: true } }),
    ).rejects.toThrow('GET requests cannot include a body');
  });
});
