import { describe, expect, it } from 'vitest';
import { handler } from '../src/handler.js';
import { createMockHostBindings, ExecuteRequest } from '@alga-psa/extension-runtime';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const baseRequest: ExecuteRequest = {
  context: {
    tenantId: 'tenant-xyz',
    extensionId: 'ext-service-proxy',
    requestId: 'req-123',
    config: { algaApiBase: 'https://alga.example.test' },
  },
  http: {
    method: 'GET',
    url: '/dynamic/tickets',
    headers: [],
    query: {},
  },
};

function decode(body?: Uint8Array | null) {
  const text = body ? decoder.decode(body) : '';
  return text ? JSON.parse(text) : {};
}

describe('service proxy handler', () => {
  it('fetches tickets using the secret API key', async () => {
    const tickets = [
      { id: 'TCK-101', title: 'Quarterly planning', status: 'open' },
      { id: 'TCK-102', title: 'New laptop provisioning', status: 'in_progress' },
    ];

    const host = createMockHostBindings({
      secrets: {
        async get(key: string) {
          expect(key).toBe('ALGA_API_KEY');
          return 'sk_live_unit_test';
        },
        async list() {
          return ['ALGA_API_KEY'];
        },
      },
      http: {
        async fetch(request) {
          expect(request.method).toBe('GET');
          expect(request.url).toContain('/api/tickets');
          expect(request.headers.find((h) => h.name.toLowerCase() === 'authorization')?.value).toBe(
            'Bearer sk_live_unit_test',
          );
          return {
            status: 200,
            headers: [{ name: 'content-type', value: 'application/json' }],
            body: encoder.encode(JSON.stringify({ tickets })),
          };
        },
      },
      logging: {
        info: async () => {},
        warn: async () => {},
        error: async () => {},
      },
    });

    const response = await handler(baseRequest, host);
    expect(response.status).toBe(200);
    const json = decode(response.body);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.tickets)).toBe(true);
    expect(json.tickets).toHaveLength(2);
    expect(json.tickets[0].id).toBe('TCK-101');
    expect(json.limit).toBe(10);
  });

  it('returns an error when the secret is missing', async () => {
    const host = createMockHostBindings({
      secrets: {
        async get() {
          throw new Error('secret not provisioned');
        },
        async list() {
          return [];
        },
      },
      logging: {
        info: async () => {},
        warn: async () => {},
        error: async () => {},
      },
    });

    const response = await handler(baseRequest, host);
    expect(response.status).toBe(500);
    const json = decode(response.body);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('missing_alga_api_key');
  });

  it('propagates upstream failure codes', async () => {
    const host = createMockHostBindings({
      secrets: {
        async get() {
          return 'sk_live_unit_test';
        },
        async list() {
          return ['ALGA_API_KEY'];
        },
      },
      http: {
        async fetch() {
          return {
            status: 503,
            headers: [{ name: 'content-type', value: 'application/json' }],
            body: encoder.encode(JSON.stringify({ error: 'service_unavailable' })),
          };
        },
      },
      logging: {
        info: async () => {},
        warn: async () => {},
        error: async () => {},
      },
    });

    const response = await handler(baseRequest, host);
    expect(response.status).toBe(502);
    const json = decode(response.body);
    expect(json.ok).toBe(false);
    expect(json.upstreamStatus).toBe(503);
  });

  it('supports UI proxy calls without exposing the API key', async () => {
    let capturedUrl = '';
    const host = createMockHostBindings({
      secrets: {
        async get() {
          return 'sk_live_unit_test';
        },
        async list() {
          return ['ALGA_API_KEY'];
        },
      },
      http: {
        async fetch(request) {
          capturedUrl = request.url;
          return {
            status: 200,
            headers: [{ name: 'content-type', value: 'application/json' }],
            body: encoder.encode(JSON.stringify({ tickets: [] })),
          };
        },
      },
      logging: {
        info: async () => {},
        warn: async () => {},
        error: async () => {},
      },
    });

    const proxyRequest: ExecuteRequest = {
      ...baseRequest,
      http: {
        method: 'POST',
        url: '/proxy/tickets/list',
        headers: [],
        body: encoder.encode(JSON.stringify({ limit: 5 })),
        query: {},
      },
    };

    const response = await handler(proxyRequest, host);
    expect(response.status).toBe(200);
    const json = decode(response.body);
    expect(json.fromProxy).toBe(true);
    expect(json.limit).toBe(5);
    expect(capturedUrl).toContain('limit=5');
  });
});
