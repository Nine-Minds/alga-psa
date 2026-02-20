import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EE_ONLY_ERROR = {
  success: false,
  error: 'Microsoft Entra integration is only available in Enterprise Edition.',
} as const;

describe('CE Entra route delegators', () => {
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

  it('returns enterprise-only payload when edition is disabled', async () => {
    process.env.EDITION = 'ce';
    delete process.env.NEXT_PUBLIC_EDITION;

    const entraStatusRoute = await import('@/app/api/integrations/entra/route');
    const entraConnectRoute = await import('@/app/api/integrations/entra/connect/route');
    const entraRunsRoute = await import('@/app/api/integrations/entra/sync/runs/route');

    const statusResponse = await entraStatusRoute.GET(
      new Request('http://localhost/api/integrations/entra', { method: 'GET' })
    );
    const connectResponse = await entraConnectRoute.POST(
      new Request('http://localhost/api/integrations/entra/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionType: 'direct' }),
      })
    );
    const runsResponse = await entraRunsRoute.GET(
      new Request('http://localhost/api/integrations/entra/sync/runs?limit=5', { method: 'GET' })
    );

    expect(statusResponse.status).toBe(501);
    await expect(statusResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(connectResponse.status).toBe(501);
    await expect(connectResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(runsResponse.status).toBe(501);
    await expect(runsResponse.json()).resolves.toEqual(EE_ONLY_ERROR);
  });

  it('forwards requests to EE handlers when enterprise edition is enabled', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeStatusGet = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true, data: { status: 'connected' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const eeConnectPost = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true, data: { connectionType: 'direct' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.doMock('@enterprise/app/api/integrations/entra/route', () => ({
      GET: eeStatusGet,
    }));
    vi.doMock('@enterprise/app/api/integrations/entra/connect/route', () => ({
      POST: eeConnectPost,
    }));

    const statusRequest = new Request('http://localhost/api/integrations/entra', { method: 'GET' });
    const connectRequest = new Request('http://localhost/api/integrations/entra/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionType: 'direct' }),
    });

    const entraStatusRoute = await import('@/app/api/integrations/entra/route');
    const entraConnectRoute = await import('@/app/api/integrations/entra/connect/route');

    const statusResponse = await entraStatusRoute.GET(statusRequest);
    const connectResponse = await entraConnectRoute.POST(connectRequest);

    expect(eeStatusGet).toHaveBeenCalledTimes(1);
    expect(eeStatusGet).toHaveBeenCalledWith(statusRequest);
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual({
      success: true,
      data: { status: 'connected' },
    });

    expect(eeConnectPost).toHaveBeenCalledTimes(1);
    expect(eeConnectPost).toHaveBeenCalledWith(connectRequest);
    expect(connectResponse.status).toBe(201);
    await expect(connectResponse.json()).resolves.toEqual({
      success: true,
      data: { connectionType: 'direct' },
    });
  });
});
