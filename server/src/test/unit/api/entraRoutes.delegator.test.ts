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
});
