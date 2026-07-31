import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EE_ONLY_ERROR = {
  success: false,
  error: 'Hudu integration is only available in Enterprise Edition.',
} as const;

// The CE delegator gates on product access before touching the EE module; grant
// access in every case so the test isolates the CE-vs-EE resolution behaviour.
vi.mock('@/lib/api/standaloneProductGuards', () => ({
  assertSessionProductAccess: vi.fn(async () => null),
}));

describe('CE /api/integrations/hudu route delegator', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.EDITION;
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }

    if (originalPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }
  });

  it('T003: returns a 501 eeUnavailable payload in a CE build', async () => {
    process.env.EDITION = 'ce';

    const route = await import('@/app/api/integrations/hudu/route');
    const response = await route.GET(
      new Request('http://localhost/api/integrations/hudu', { method: 'GET' })
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual(EE_ONLY_ERROR);
  });

  it('T004: resolves the real EE route (not the 501 stub) in an EE build', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeGet = vi.fn(
      async () => new Response(JSON.stringify({ success: true, data: { status: 'not_connected' } }), { status: 200 })
    );

    vi.doMock('@enterprise/app/api/integrations/hudu/route', () => ({
      GET: eeGet,
    }));

    const request = new Request('http://localhost/api/integrations/hudu', { method: 'GET' });
    const route = await import('@/app/api/integrations/hudu/route');
    const response = await route.GET(request);

    expect(eeGet).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: 'not_connected' },
    });
  });

  it('T004: returns OPTIONS preflight without loading the EE module in CE', async () => {
    process.env.EDITION = 'ce';

    const route = await import('@/app/api/integrations/hudu/route');
    const response = await route.OPTIONS(
      new Request('http://localhost/api/integrations/hudu', { method: 'OPTIONS' })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });
});
