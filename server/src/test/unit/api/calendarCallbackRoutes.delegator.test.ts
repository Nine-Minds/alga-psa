import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const EE_ONLY_ERROR = {
  success: false,
  error: 'Calendar sync is only available in Enterprise Edition.',
} as const;

function decodeEmbeddedPopupPayload(html: string): Record<string, unknown> {
  const match = html.match(/atob\('([^']+)'\)/);
  if (!match) {
    throw new Error('Expected popup payload to be embedded in the callback HTML response');
  }

  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
}

describe('Calendar callback route delegators', () => {
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

  it('returns enterprise-only payloads in CE without executing EE callback handlers', async () => {
    process.env.EDITION = 'ce';

    const googleRoute = await import('@/app/api/auth/google/calendar/callback/route');
    const microsoftRoute = await import('@/app/api/auth/microsoft/calendar/callback/route');

    const googleRequest = new Request('http://localhost/api/auth/google/calendar/callback?code=abc&state=nonce', { method: 'GET' });
    const microsoftRequest = new Request('http://localhost/api/auth/microsoft/calendar/callback?code=abc&state=nonce', { method: 'GET' });

    const googleResponse = await googleRoute.GET(googleRequest as never);
    const microsoftResponse = await microsoftRoute.GET(microsoftRequest as never);

    expect(googleResponse.status).toBe(501);
    await expect(googleResponse.json()).resolves.toEqual(EE_ONLY_ERROR);

    expect(microsoftResponse.status).toBe(501);
    await expect(microsoftResponse.json()).resolves.toEqual(EE_ONLY_ERROR);
  });

  it('forwards Google and Microsoft calendar callback requests to EE handlers in enterprise mode', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeGoogleGet = vi.fn(async () => new Response(JSON.stringify({ ok: 'google' }), { status: 200 }));
    const eeMicrosoftGet = vi.fn(async () => new Response(JSON.stringify({ ok: 'microsoft' }), { status: 200 }));

    vi.doMock('@enterprise/app/api/auth/google/calendar/callback/route', () => ({
      GET: eeGoogleGet,
    }));
    vi.doMock('@enterprise/app/api/auth/microsoft/calendar/callback/route', () => ({
      GET: eeMicrosoftGet,
    }));

    const googleRequest = new Request('http://localhost/api/auth/google/calendar/callback?code=abc&state=nonce', { method: 'GET' });
    const microsoftRequest = new Request('http://localhost/api/auth/microsoft/calendar/callback?code=def&state=nonce-2&popup=true', { method: 'GET' });

    const googleRoute = await import('@/app/api/auth/google/calendar/callback/route');
    const microsoftRoute = await import('@/app/api/auth/microsoft/calendar/callback/route');

    const googleResponse = await googleRoute.GET(googleRequest as never);
    const microsoftResponse = await microsoftRoute.GET(microsoftRequest as never);

    expect(eeGoogleGet).toHaveBeenCalledWith(googleRequest);
    expect(googleResponse.status).toBe(200);
    await expect(googleResponse.json()).resolves.toEqual({ ok: 'google' });

    expect(eeMicrosoftGet).toHaveBeenCalledWith(microsoftRequest);
    expect(microsoftResponse.status).toBe(200);
    await expect(microsoftResponse.json()).resolves.toEqual({ ok: 'microsoft' });
  });

  it('keeps live calendar callback logic out of shared route wrappers', () => {
    const serverRoot = process.cwd();
    const googleSharedSource = fs.readFileSync(path.join(serverRoot, 'src/app/api/auth/google/calendar/callback/route.ts'), 'utf8');
    const microsoftSharedSource = fs.readFileSync(path.join(serverRoot, 'src/app/api/auth/microsoft/calendar/callback/route.ts'), 'utf8');
    const googleEeSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/app/api/auth/google/calendar/callback/route.ts'),
      'utf8'
    );
    const microsoftEeSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/app/api/auth/microsoft/calendar/callback/route.ts'),
      'utf8'
    );

    expect(googleSharedSource).toContain('loadCalendarEeRoute');
    expect(googleSharedSource).toContain('eeUnavailable');
    expect(googleSharedSource).not.toContain('CalendarProviderService');
    expect(googleSharedSource).not.toContain('GoogleCalendarAdapter');
    expect(googleSharedSource).not.toContain('consumeCalendarOAuthState');

    expect(microsoftSharedSource).toContain('loadCalendarEeRoute');
    expect(microsoftSharedSource).toContain('eeUnavailable');
    expect(microsoftSharedSource).not.toContain('CalendarProviderService');
    expect(microsoftSharedSource).not.toContain('MicrosoftCalendarAdapter');
    expect(microsoftSharedSource).not.toContain('consumeCalendarOAuthState');

    expect(googleEeSource).toContain('CalendarProviderService');
    expect(googleEeSource).toContain('GoogleCalendarAdapter');
    expect(googleEeSource).toContain('consumeCalendarOAuthState');

    expect(microsoftEeSource).toContain('CalendarProviderService');
    expect(microsoftEeSource).toContain('MicrosoftCalendarAdapter');
    expect(microsoftEeSource).toContain('consumeCalendarOAuthState');
  });

  it('preserves malformed-input handling in the EE callback implementations', async () => {
    const googleEeRoute = await import('../../../../../ee/packages/calendar/src/app/api/auth/google/calendar/callback/route');
    const microsoftEeRoute = await import('../../../../../ee/packages/calendar/src/app/api/auth/microsoft/calendar/callback/route');

    const googleResponse = await googleEeRoute.GET(
      new NextRequest('http://localhost/api/auth/google/calendar/callback?state=nonce-only', { method: 'GET' }) as never
    );
    const microsoftResponse = await microsoftEeRoute.GET(
      new NextRequest('http://localhost/api/auth/microsoft/calendar/callback?popup=true&code=abc', { method: 'GET' }) as never
    );

    expect(googleResponse.status).toBe(200);
    const googlePayload = decodeEmbeddedPopupPayload(await googleResponse.text());
    expect(googlePayload).toMatchObject({
      success: false,
      error: 'missing_parameters',
    });

    expect(microsoftResponse.status).toBe(200);
    const microsoftPayload = decodeEmbeddedPopupPayload(await microsoftResponse.text());
    expect(microsoftPayload).toMatchObject({
      success: false,
      error: 'missing_parameters',
    });
  });
});
