import { describe, it, expect, vi } from 'vitest';
import { handler } from '../src/handler';
import type { ExecuteRequest, HostBindings } from '@alga-psa/extension-runtime';

const mockHost: HostBindings = {
  context: { get: vi.fn() },
  secrets: {
    get: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  },
  http: { fetch: vi.fn() },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
  logging: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  uiProxy: { callRoute: vi.fn() },
  user: { get: vi.fn() },
  scheduler: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: vi.fn().mockResolvedValue({ success: true, scheduleId: 'test-123' }),
    update: vi.fn(),
    delete: vi.fn().mockResolvedValue({ success: true }),
    getEndpoints: vi.fn().mockResolvedValue([]),
  },
};

function makeRequest(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    context: {
      tenantId: 'test-tenant',
      extensionId: 'com.alga.sample.scheduler-demo',
      requestId: 'req-123',
      ...overrides.context,
    },
    http: {
      method: 'GET',
      url: '/api/status',
      headers: [],
      ...overrides.http,
    },
  };
}

describe('scheduler-demo handler', () => {
  it('returns status for GET /api/status', async () => {
    const request = makeRequest({ http: { method: 'GET', url: '/api/status', headers: [] } });
    const response = await handler(request, mockHost);

    expect(response.status).toBe(200);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    expect(body.status).toBe('healthy');
    expect(body.tenant).toBe('test-tenant');
  });

  it('lists schedules for GET /api/schedules', async () => {
    const request = makeRequest({ http: { method: 'GET', url: '/api/schedules', headers: [] } });
    const response = await handler(request, mockHost);

    expect(response.status).toBe(200);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    expect(body.count).toBe(0);
    expect(body.schedules).toEqual([]);
  });

  it('supports proxy-style method override from body for schedule listing', async () => {
    const request = makeRequest({
      http: {
        method: 'POST',
        url: '/api/schedules',
        headers: [],
        body: new TextEncoder().encode(JSON.stringify({ __method: 'GET' })),
      },
    });
    const response = await handler(request, mockHost);

    expect(response.status).toBe(200);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    expect(body.count).toBe(0);
  });

  it('supports proxy-style method override from body for schedule delete', async () => {
    const request = makeRequest({
      http: {
        method: 'POST',
        url: '/api/schedules/sched-1',
        headers: [],
        body: new TextEncoder().encode(JSON.stringify({ __method: 'DELETE' })),
      },
    });
    const response = await handler(request, mockHost);

    expect(response.status).toBe(200);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    expect(body.scheduleId).toBe('sched-1');
  });

  it('returns 404 for unknown routes', async () => {
    const request = makeRequest({ http: { method: 'GET', url: '/unknown', headers: [] } });
    const response = await handler(request, mockHost);

    expect(response.status).toBe(404);
  });

  it('handles POST /api/setup', async () => {
    const createSpy = vi.spyOn(mockHost.scheduler!, 'create');
    const request = makeRequest({ http: { method: 'POST', url: '/api/setup', headers: [] } });
    const response = await handler(request, mockHost);

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    expect(body.results).toBeDefined();
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ endpoint: '/api/heartbeat' }));
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ endpoint: '/api/status' }));
  });
});
