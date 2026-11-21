import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The error branches under test return before any dependency is touched; mock the
// heavy ones so importing the EE routes does not need a database or secrets store.
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: vi.fn(), runWithTenant: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn() }));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: vi.fn(),
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter', () => ({
  MicrosoftCalendarAdapter: vi.fn(),
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter', () => ({
  GoogleCalendarAdapter: vi.fn(),
}));
vi.mock('../../../../../ee/packages/calendar/src/lib/microsoftConsumerProfileResolution', () => ({
  resolveMicrosoftConsumerProfileConfig: vi.fn(),
}));
vi.mock('../../../../../ee/packages/calendar/src/lib/utils/calendar/oauthStateStore', () => ({
  consumeCalendarOAuthState: vi.fn(),
}));

import { GET as microsoftGet } from '../../../../../ee/packages/calendar/src/app/api/auth/microsoft/calendar/callback/route';
import { GET as googleGet } from '../../../../../ee/packages/calendar/src/app/api/auth/google/calendar/callback/route';

function popupState(provider: 'microsoft' | 'google'): string {
  return Buffer.from(
    JSON.stringify({ tenant: 't1', provider, nonce: 'n1', timestamp: Date.now(), isPopup: true })
  ).toString('base64');
}

function decodeEmbeddedPayload(html: string): Record<string, unknown> {
  const match = html.match(/atob\('([^']+)'\)/);
  if (!match) throw new Error('Expected popup payload embedded in callback HTML');
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
}

function request(provider: 'microsoft' | 'google', params: Record<string, string>): NextRequest {
  const url = new URL(`http://localhost:3000/api/auth/${provider}/calendar/callback`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

describe('calendar OAuth callbacks: error responses honor isPopup from state', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each([
    ['AADSTS65001', 'AADSTS65001: The user or administrator has not consented to use the application.'],
    ['AADSTS90094', 'AADSTS90094: The grant requires admin permission.'],
  ])('microsoft: %s consent error with isPopup only in state posts pending_admin_consent', async (_code, description) => {
    const res = await microsoftGet(
      request('microsoft', {
        error: 'consent_required',
        error_description: description,
        state: popupState('microsoft'),
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const payload = decodeEmbeddedPayload(await res.text());
    expect(payload).toMatchObject({
      type: 'oauth-callback',
      provider: 'microsoft',
      resource: 'calendar',
      success: false,
      error: 'pending_admin_consent',
    });
  });

  it('microsoft: consent error with no state and no popup param still redirects to the profile Calendar tab', async () => {
    const res = await microsoftGet(
      request('microsoft', {
        error: 'consent_required',
        error_description: 'AADSTS65001: The user or administrator has not consented.',
      })
    );

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/msp/profile');
    expect(location.searchParams.get('tab')).toBe('Calendar');
    expect(location.searchParams.get('calendarAuth')).toBe('error');
  });

  it('microsoft: undecodable state with error and ?popup=true still posts a message', async () => {
    const res = await microsoftGet(
      request('microsoft', { error: 'access_denied', state: '%%%not-base64-json', popup: 'true' })
    );
    expect(res.status).toBe(200);
    expect(decodeEmbeddedPayload(await res.text())).toMatchObject({ success: false, error: 'access_denied' });
  });

  it('google: error with isPopup only in state posts the error to the opener', async () => {
    const res = await googleGet(
      request('google', {
        error: 'access_denied',
        error_description: 'User denied access',
        state: popupState('google'),
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(decodeEmbeddedPayload(await res.text())).toMatchObject({
      type: 'oauth-callback',
      provider: 'google',
      resource: 'calendar',
      success: false,
      error: 'access_denied',
    });
  });
});
