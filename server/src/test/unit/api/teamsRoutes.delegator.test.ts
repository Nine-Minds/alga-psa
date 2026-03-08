import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EE_ONLY_ERROR = {
  success: false,
  error: 'Microsoft Teams integration is only available in Enterprise Edition.',
} as const;

describe('CE Teams route delegators', () => {
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

  it('T113/T121/T131/T147/T204/T407: returns enterprise-only payloads in CE without executing Teams runtime handlers', async () => {
    process.env.EDITION = 'ce';

    const botRoute = await import('@/app/api/teams/bot/messages/route');
    const messageExtensionRoute = await import('@/app/api/teams/message-extension/query/route');
    const quickActionsRoute = await import('@/app/api/teams/quick-actions/route');
    const authTabRoute = await import('@/app/api/teams/auth/callback/tab/route');

    const botResponse = await botRoute.POST(new Request('http://localhost/api/teams/bot/messages', { method: 'POST' }));
    const messageExtensionResponse = await messageExtensionRoute.POST(
      new Request('http://localhost/api/teams/message-extension/query', { method: 'POST' })
    );
    const quickActionsResponse = await quickActionsRoute.POST(
      new Request('http://localhost/api/teams/quick-actions', { method: 'POST' })
    );
    const authTabResponse = await authTabRoute.GET(
      new Request('http://localhost/api/teams/auth/callback/tab?tenantId=tenant-1', { method: 'GET' })
    );

    expect(botResponse.status).toBe(501);
    await expect(botResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(messageExtensionResponse.status).toBe(501);
    await expect(messageExtensionResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(quickActionsResponse.status).toBe(501);
    await expect(quickActionsResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(authTabResponse.status).toBe(501);
    await expect(authTabResponse.json()).resolves.toEqual(EE_ONLY_ERROR);
  });

  it('T117/T125/T135/T143/T203/T405: forwards Teams requests to EE handlers when enterprise edition is enabled', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeBotPost = vi.fn(async () => new Response(JSON.stringify({ ok: 'bot' }), { status: 200 }));
    const eeMessageExtensionPost = vi.fn(async () => new Response(JSON.stringify({ ok: 'message-extension' }), { status: 200 }));
    const eeQuickActionsPost = vi.fn(async () => new Response(JSON.stringify({ ok: 'quick-actions' }), { status: 200 }));
    const eeAuthTabGet = vi.fn(async () => new Response('auth ok', { status: 200 }));

    vi.doMock('@enterprise/app/api/teams/bot/messages/route', () => ({
      POST: eeBotPost,
    }));
    vi.doMock('@enterprise/app/api/teams/message-extension/query/route', () => ({
      POST: eeMessageExtensionPost,
    }));
    vi.doMock('@enterprise/app/api/teams/quick-actions/route', () => ({
      POST: eeQuickActionsPost,
    }));
    vi.doMock('@enterprise/app/api/teams/auth/callback/tab/route', () => ({
      GET: eeAuthTabGet,
    }));

    const botRequest = new Request('http://localhost/api/teams/bot/messages', { method: 'POST' });
    const messageExtensionRequest = new Request('http://localhost/api/teams/message-extension/query', { method: 'POST' });
    const quickActionsRequest = new Request('http://localhost/api/teams/quick-actions', { method: 'POST' });
    const authTabRequest = new Request('http://localhost/api/teams/auth/callback/tab?tenantId=tenant-1', { method: 'GET' });

    const botRoute = await import('@/app/api/teams/bot/messages/route');
    const messageExtensionRoute = await import('@/app/api/teams/message-extension/query/route');
    const quickActionsRoute = await import('@/app/api/teams/quick-actions/route');
    const authTabRoute = await import('@/app/api/teams/auth/callback/tab/route');

    const botResponse = await botRoute.POST(botRequest);
    const messageExtensionResponse = await messageExtensionRoute.POST(messageExtensionRequest);
    const quickActionsResponse = await quickActionsRoute.POST(quickActionsRequest);
    const authTabResponse = await authTabRoute.GET(authTabRequest);

    expect(eeBotPost).toHaveBeenCalledWith(botRequest);
    expect(botResponse.status).toBe(200);

    expect(eeMessageExtensionPost).toHaveBeenCalledWith(messageExtensionRequest);
    expect(messageExtensionResponse.status).toBe(200);

    expect(eeQuickActionsPost).toHaveBeenCalledWith(quickActionsRequest);
    expect(quickActionsResponse.status).toBe(200);

    expect(eeAuthTabGet).toHaveBeenCalledWith(authTabRequest);
    expect(authTabResponse.status).toBe(200);
  });
});
