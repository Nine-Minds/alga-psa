import { describe, expect, it } from 'vitest';
import { callProxyJson, createMockHostBindings, jsonResponse } from '../src/index.js';

describe('extension-runtime', () => {
  it('creates json responses', () => {
    const response = jsonResponse({ ok: true });
    expect(response.status).toBe(200);
    expect(response.headers?.[0]?.name).toBe('content-type');
  });

  it('creates mock bindings', async () => {
    const bindings = createMockHostBindings({
      secrets: {
        async get() { return 'secret'; },
        async list() { return ['secret']; },
      },
    });
    const ctx = await bindings.context.get();
    expect(ctx.tenantId).toBe('tenant-mock');
    expect(await bindings.secrets.get('any')).toBe('secret');
    expect(typeof bindings.invoicing.createManualInvoice).toBe('function');
  });

  it('wraps ui proxy calls', async () => {
    const host = createMockHostBindings({
      uiProxy: {
        async call(route: string, payload?: Uint8Array | null) {
          expect(route).toBe('/demo');
          expect(payload).toBeDefined();
          return new TextEncoder().encode(JSON.stringify({ ok: true }));
        },
      },
    });

    const result = await callProxyJson(host.uiProxy, '/demo', { ping: true });
    expect(result).toEqual({ ok: true });
  });
});
