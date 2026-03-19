import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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

  it('T113/T121/T131/T147/T204/T229/T230/T277/T278/T431: returns enterprise-only payloads in CE without executing Teams runtime handlers', async () => {
    process.env.EDITION = 'ce';

    const botRoute = await import('@/app/api/teams/bot/messages/route');
    const messageExtensionRoute = await import('@/app/api/teams/message-extension/query/route');
    const quickActionsRoute = await import('@/app/api/teams/quick-actions/route');
    const authBotRoute = await import('@/app/api/teams/auth/callback/bot/route');
    const authMessageExtensionRoute = await import('@/app/api/teams/auth/callback/message-extension/route');
    const authTabRoute = await import('@/app/api/teams/auth/callback/tab/route');
    const packageRoute = await import('@/app/api/teams/package/route');

    const botResponse = await botRoute.POST(new Request('http://localhost/api/teams/bot/messages', { method: 'POST' }));
    const messageExtensionResponse = await messageExtensionRoute.POST(
      new Request('http://localhost/api/teams/message-extension/query', { method: 'POST' })
    );
    const quickActionsResponse = await quickActionsRoute.POST(
      new Request('http://localhost/api/teams/quick-actions', { method: 'POST' })
    );
    const authBotResponse = await authBotRoute.GET(
      new Request('http://localhost/api/teams/auth/callback/bot?tenantId=tenant-1', { method: 'GET' })
    );
    const authMessageExtensionResponse = await authMessageExtensionRoute.GET(
      new Request('http://localhost/api/teams/auth/callback/message-extension?tenantId=tenant-1', { method: 'GET' })
    );
    const authTabResponse = await authTabRoute.GET(
      new Request('http://localhost/api/teams/auth/callback/tab?tenantId=tenant-1', { method: 'GET' })
    );
    const packageResponse = await packageRoute.GET(new Request('http://localhost/api/teams/package', { method: 'GET' }));

    expect(botResponse.status).toBe(501);
    await expect(botResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(messageExtensionResponse.status).toBe(501);
    await expect(messageExtensionResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(quickActionsResponse.status).toBe(501);
    await expect(quickActionsResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(authBotResponse.status).toBe(501);
    await expect(authBotResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(authMessageExtensionResponse.status).toBe(501);
    await expect(authMessageExtensionResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(authTabResponse.status).toBe(501);
    await expect(authTabResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(packageResponse.status).toBe(501);
    await expect(packageResponse.json()).resolves.toEqual(EE_ONLY_ERROR);
  });

  it('T117/T125/T135/T143/T203/T233/T234/T279/T280/T432: forwards Teams requests to EE handlers when enterprise edition is enabled', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeBotPost = vi.fn(async () => new Response(JSON.stringify({ ok: 'bot' }), { status: 200 }));
    const eeMessageExtensionPost = vi.fn(async () => new Response(JSON.stringify({ ok: 'message-extension' }), { status: 200 }));
    const eeQuickActionsPost = vi.fn(async () => new Response(JSON.stringify({ ok: 'quick-actions' }), { status: 200 }));
    const eeAuthBotGet = vi.fn(async () => new Response('auth bot ok', { status: 200 }));
    const eeAuthMessageExtensionGet = vi.fn(async () => new Response('auth message-extension ok', { status: 200 }));
    const eeAuthTabGet = vi.fn(async () => new Response('auth ok', { status: 200 }));
    const eePackageGet = vi.fn(async () => new Response(JSON.stringify({ ok: 'package-get' }), { status: 200 }));
    const eePackagePost = vi.fn(async () => new Response(JSON.stringify({ ok: 'package-post' }), { status: 200 }));

    vi.doMock('@enterprise/app/api/teams/bot/messages/route', () => ({
      POST: eeBotPost,
    }));
    vi.doMock('@enterprise/app/api/teams/message-extension/query/route', () => ({
      POST: eeMessageExtensionPost,
    }));
    vi.doMock('@enterprise/app/api/teams/quick-actions/route', () => ({
      POST: eeQuickActionsPost,
    }));
    vi.doMock('@enterprise/app/api/teams/auth/callback/bot/route', () => ({
      GET: eeAuthBotGet,
    }));
    vi.doMock('@enterprise/app/api/teams/auth/callback/message-extension/route', () => ({
      GET: eeAuthMessageExtensionGet,
    }));
    vi.doMock('@enterprise/app/api/teams/auth/callback/tab/route', () => ({
      GET: eeAuthTabGet,
    }));
    vi.doMock('@enterprise/app/api/teams/package/route', () => ({
      GET: eePackageGet,
      POST: eePackagePost,
    }));

    const botRequest = new Request('http://localhost/api/teams/bot/messages', { method: 'POST' });
    const messageExtensionRequest = new Request('http://localhost/api/teams/message-extension/query', { method: 'POST' });
    const quickActionsRequest = new Request('http://localhost/api/teams/quick-actions', { method: 'POST' });
    const authBotRequest = new Request('http://localhost/api/teams/auth/callback/bot?tenantId=tenant-1', { method: 'GET' });
    const authMessageExtensionRequest = new Request(
      'http://localhost/api/teams/auth/callback/message-extension?tenantId=tenant-1',
      { method: 'GET' }
    );
    const authTabRequest = new Request('http://localhost/api/teams/auth/callback/tab?tenantId=tenant-1', { method: 'GET' });
    const packageGetRequest = new Request('http://localhost/api/teams/package', { method: 'GET' });
    const packagePostRequest = new Request('http://localhost/api/teams/package', { method: 'POST' });

    const botRoute = await import('@/app/api/teams/bot/messages/route');
    const messageExtensionRoute = await import('@/app/api/teams/message-extension/query/route');
    const quickActionsRoute = await import('@/app/api/teams/quick-actions/route');
    const authBotRoute = await import('@/app/api/teams/auth/callback/bot/route');
    const authMessageExtensionRoute = await import('@/app/api/teams/auth/callback/message-extension/route');
    const authTabRoute = await import('@/app/api/teams/auth/callback/tab/route');
    const packageRoute = await import('@/app/api/teams/package/route');

    const botResponse = await botRoute.POST(botRequest);
    const messageExtensionResponse = await messageExtensionRoute.POST(messageExtensionRequest);
    const quickActionsResponse = await quickActionsRoute.POST(quickActionsRequest);
    const authBotResponse = await authBotRoute.GET(authBotRequest);
    const authMessageExtensionResponse = await authMessageExtensionRoute.GET(authMessageExtensionRequest);
    const authTabResponse = await authTabRoute.GET(authTabRequest);
    const packageGetResponse = await packageRoute.GET(packageGetRequest);
    const packagePostResponse = await packageRoute.POST(packagePostRequest);

    expect(eeBotPost).toHaveBeenCalledWith(botRequest);
    expect(botResponse.status).toBe(200);

    expect(eeMessageExtensionPost).toHaveBeenCalledWith(messageExtensionRequest);
    expect(messageExtensionResponse.status).toBe(200);

    expect(eeQuickActionsPost).toHaveBeenCalledWith(quickActionsRequest);
    expect(quickActionsResponse.status).toBe(200);

    expect(eeAuthBotGet).toHaveBeenCalledWith(authBotRequest);
    expect(authBotResponse.status).toBe(200);

    expect(eeAuthMessageExtensionGet).toHaveBeenCalledWith(authMessageExtensionRequest);
    expect(authMessageExtensionResponse.status).toBe(200);

    expect(eeAuthTabGet).toHaveBeenCalledWith(authTabRequest);
    expect(authTabResponse.status).toBe(200);

    expect(eePackageGet).toHaveBeenCalledWith(packageGetRequest);
    expect(packageGetResponse.status).toBe(200);

    expect(eePackagePost).toHaveBeenCalledWith(packagePostRequest);
    expect(packagePostResponse.status).toBe(200);
  });

  it('T153/T154: keeps OPTIONS responses valid for CE Teams API stubs without loading EE handlers', async () => {
    process.env.EDITION = 'ce';

    const botRoute = await import('@/app/api/teams/bot/messages/route');
    const packageRoute = await import('@/app/api/teams/package/route');

    const botOptions = await botRoute.OPTIONS();
    const packageOptions = await packageRoute.OPTIONS();

    expect(botOptions.status).toBe(204);
    expect(botOptions.headers.get('Allow')).toBe('POST, OPTIONS');

    expect(packageOptions.status).toBe(204);
    expect(packageOptions.headers.get('Allow')).toBe('GET, POST, OPTIONS');
  });

  it('T157/T158: logs bounded EE import failures and falls back to the stable enterprise-only response', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.doMock('@enterprise/app/api/teams/package/route', () => {
      throw new Error('module exploded');
    });

    const packageRoute = await import('@/app/api/teams/package/route');
    const response = await packageRoute.GET(new Request('http://localhost/api/teams/package', { method: 'GET' }));

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[teams/package] Failed to load EE route:'));
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual(EE_ONLY_ERROR);
  });

  it('T155/T156/T159/T160/T163/T164/T351/T352/T405/T406/T407/T408: keeps shared Teams routes as cached wrapper-only delegators without direct runtime logic', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const eeDelegatorSource = fs.readFileSync(path.join(repoRoot, 'server/src/app/api/teams/_eeDelegator.ts'), 'utf8');
    const sharedTabPageSource = fs.readFileSync(path.join(repoRoot, 'server/src/app/teams/tab/page.tsx'), 'utf8');
    const sharedRouteSources = [
      'server/src/app/api/teams/bot/messages/route.ts',
      'server/src/app/api/teams/message-extension/query/route.ts',
      'server/src/app/api/teams/quick-actions/route.ts',
      'server/src/app/api/teams/auth/callback/tab/route.ts',
      'server/src/app/api/teams/auth/callback/bot/route.ts',
      'server/src/app/api/teams/auth/callback/message-extension/route.ts',
      'server/src/app/api/teams/package/route.ts',
    ].map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));

    expect(eeDelegatorSource).toContain('const eeRouteModulePromises = new Map<string, Promise<unknown | null>>();');
    expect(eeDelegatorSource).toContain('if (!eeRouteModulePromises.has(routeKey))');

    for (const source of sharedRouteSources) {
      expect(source).toContain('loadTeamsEeRoute');
      expect(source).toContain('eeUnavailable');
      expect(source).not.toContain('teamsBotHandler');
      expect(source).not.toContain('teamsMessageExtensionHandler');
      expect(source).not.toContain('teamsQuickActionHandler');
      expect(source).not.toContain('handleTeamsAuthCallback');
    }

    expect(sharedTabPageSource).toContain("import('@enterprise/app/teams/tab/page')");
    expect(sharedTabPageSource).not.toContain('resolveTeamsTabAuthState');
    expect(sharedTabPageSource).not.toContain('resolveTeamsTabAccessState');
  });
});
