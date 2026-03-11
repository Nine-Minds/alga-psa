import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const EE_ONLY_ERROR = {
  success: false,
  error: 'Calendar sync is only available in Enterprise Edition.',
} as const;

describe('Calendar webhook route delegators', () => {
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

  it('returns enterprise-only payloads in CE without executing EE webhook handlers', async () => {
    process.env.EDITION = 'ce';

    const googleRoute = await import('@/app/api/calendar/webhooks/google/route');
    const microsoftRoute = await import('@/app/api/calendar/webhooks/microsoft/route');

    const googleResponse = await googleRoute.POST(
      new Request('http://localhost/api/calendar/webhooks/google', { method: 'POST' }) as never
    );
    const microsoftResponse = await microsoftRoute.POST(
      new Request('http://localhost/api/calendar/webhooks/microsoft', { method: 'POST' }) as never
    );

    expect(googleResponse.status).toBe(501);
    await expect(googleResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(microsoftResponse.status).toBe(501);
    await expect(microsoftResponse.json()).resolves.toEqual(EE_ONLY_ERROR);
  });

  it('forwards Google and Microsoft webhook requests to EE handlers in enterprise mode', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeGoogleGet = vi.fn(async () => new Response(JSON.stringify({ ok: 'google-get' }), { status: 200 }));
    const eeGooglePost = vi.fn(async () => new Response(JSON.stringify({ ok: 'google-post' }), { status: 202 }));
    const eeGoogleOptions = vi.fn(async () => new Response(null, { status: 204 }));
    const eeMicrosoftGet = vi.fn(async () => new Response(JSON.stringify({ ok: 'microsoft-get' }), { status: 200 }));
    const eeMicrosoftPost = vi.fn(async () => new Response(JSON.stringify({ ok: 'microsoft-post' }), { status: 202 }));
    const eeMicrosoftOptions = vi.fn(async () => new Response(null, { status: 204 }));

    vi.doMock('@enterprise/app/api/calendar/webhooks/google/route', () => ({
      GET: eeGoogleGet,
      POST: eeGooglePost,
      OPTIONS: eeGoogleOptions,
    }));
    vi.doMock('@enterprise/app/api/calendar/webhooks/microsoft/route', () => ({
      GET: eeMicrosoftGet,
      POST: eeMicrosoftPost,
      OPTIONS: eeMicrosoftOptions,
    }));

    const googleRoute = await import('@/app/api/calendar/webhooks/google/route');
    const microsoftRoute = await import('@/app/api/calendar/webhooks/microsoft/route');

    const googleGetRequest = new Request('http://localhost/api/calendar/webhooks/google?validationToken=abc', { method: 'GET' });
    const googlePostRequest = new Request('http://localhost/api/calendar/webhooks/google', { method: 'POST' });
    const googleOptionsRequest = new Request('http://localhost/api/calendar/webhooks/google', { method: 'OPTIONS' });
    const microsoftGetRequest = new Request('http://localhost/api/calendar/webhooks/microsoft?validationToken=abc', { method: 'GET' });
    const microsoftPostRequest = new Request('http://localhost/api/calendar/webhooks/microsoft', { method: 'POST' });
    const microsoftOptionsRequest = new Request('http://localhost/api/calendar/webhooks/microsoft', { method: 'OPTIONS' });

    const googleGetResponse = await googleRoute.GET(googleGetRequest as never);
    const googlePostResponse = await googleRoute.POST(googlePostRequest as never);
    const googleOptionsResponse = await googleRoute.OPTIONS(googleOptionsRequest as never);
    const microsoftGetResponse = await microsoftRoute.GET(microsoftGetRequest as never);
    const microsoftPostResponse = await microsoftRoute.POST(microsoftPostRequest as never);
    const microsoftOptionsResponse = await microsoftRoute.OPTIONS(microsoftOptionsRequest as never);

    expect(eeGoogleGet).toHaveBeenCalledWith(googleGetRequest);
    expect(eeGooglePost).toHaveBeenCalledWith(googlePostRequest);
    expect(eeGoogleOptions).toHaveBeenCalledWith(googleOptionsRequest);
    expect(googleGetResponse.status).toBe(200);
    expect(googlePostResponse.status).toBe(202);
    expect(googleOptionsResponse.status).toBe(204);

    expect(eeMicrosoftGet).toHaveBeenCalledWith(microsoftGetRequest);
    expect(eeMicrosoftPost).toHaveBeenCalledWith(microsoftPostRequest);
    expect(eeMicrosoftOptions).toHaveBeenCalledWith(microsoftOptionsRequest);
    expect(microsoftGetResponse.status).toBe(200);
    expect(microsoftPostResponse.status).toBe(202);
    expect(microsoftOptionsResponse.status).toBe(204);
  });

  it('keeps live calendar webhook logic out of shared route wrappers', () => {
    const serverRoot = process.cwd();
    const googleSharedSource = fs.readFileSync(path.join(serverRoot, 'src/app/api/calendar/webhooks/google/route.ts'), 'utf8');
    const microsoftSharedSource = fs.readFileSync(path.join(serverRoot, 'src/app/api/calendar/webhooks/microsoft/route.ts'), 'utf8');
    const googleEeSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/app/api/calendar/webhooks/google/route.ts'),
      'utf8'
    );
    const microsoftEeSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/app/api/calendar/webhooks/microsoft/route.ts'),
      'utf8'
    );

    expect(googleSharedSource).toContain('loadCalendarEeRoute');
    expect(googleSharedSource).toContain('eeUnavailable');
    expect(googleSharedSource).not.toContain('@alga-psa/integrations/webhooks/calendar/google');
    expect(googleSharedSource).not.toContain('CalendarWebhookProcessor');

    expect(microsoftSharedSource).toContain('loadCalendarEeRoute');
    expect(microsoftSharedSource).toContain('eeUnavailable');
    expect(microsoftSharedSource).not.toContain('@alga-psa/integrations/webhooks/calendar/microsoft');
    expect(microsoftSharedSource).not.toContain('CalendarWebhookProcessor');

    expect(googleEeSource).toContain('CalendarWebhookProcessor');
    expect(microsoftEeSource).toContain('CalendarWebhookProcessor');
  });
});
