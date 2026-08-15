import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const assertSessionProductAccessMock = vi.fn();
const handlerSpies: Record<string, ReturnType<typeof vi.fn>> = {
  GET: vi.fn(),
  POST: vi.fn(),
  PUT: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
};

vi.mock('@/lib/api/standaloneProductGuards', () => ({
  assertSessionProductAccess: (...args: unknown[]) => assertSessionProductAccessMock(...args),
}));

vi.mock('@product/ext-proxy/ee/handler', () => ({
  GET: (...args: unknown[]) => handlerSpies.GET(...args),
  POST: (...args: unknown[]) => handlerSpies.POST(...args),
  PUT: (...args: unknown[]) => handlerSpies.PUT(...args),
  PATCH: (...args: unknown[]) => handlerSpies.PATCH(...args),
  DELETE: (...args: unknown[]) => handlerSpies.DELETE(...args),
}));

const route = await import('./route');

function buildRequest(method: string, headers: Record<string, string> = {}) {
  return new NextRequest('https://example.test/api/ext-proxy/demo/tickets', {
    method,
    headers,
  });
}

function buildContext() {
  return { params: Promise.resolve({ extensionId: 'demo', path: ['tickets'] }) };
}

function deniedResponse(status: number) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

describe('/api/ext-proxy delegator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

    it.each(VERBS)(
      'returns the denied session response without invoking the EE handler for %s',
      async (verb) => {
        assertSessionProductAccessMock.mockResolvedValue(deniedResponse(401));

        const handler = route[verb] as typeof route.GET;
        const response = await handler(
          buildRequest(verb, { 'x-alga-tenant': 'attacker-tenant' }),
          buildContext(),
        );

      expect(response.status).toBe(401);
      expect(handlerSpies[verb]).not.toHaveBeenCalled();
      for (const other of VERBS) {
        if (other !== verb) {
          expect(handlerSpies[other]).not.toHaveBeenCalled();
        }
      }
    },
  );

  it('delegates to the EE handler when the session guard passes', async () => {
    assertSessionProductAccessMock.mockResolvedValue(null);
    handlerSpies.GET.mockResolvedValue(
      new Response('proxied', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    const response = await route.GET(buildRequest('GET'), buildContext());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('proxied');
    expect(handlerSpies.GET).toHaveBeenCalledTimes(1);
  });
});
