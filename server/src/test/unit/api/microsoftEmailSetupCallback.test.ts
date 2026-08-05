import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getSigningSecret: vi.fn(),
  validateState: vi.fn(),
  consumeState: vi.fn(),
  complete: vi.fn(),
  confirmConsent: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => hoisted.getCurrentUser(...args),
}));

vi.mock('@alga-psa/integrations/actions/integrations/microsoftEmailSetupActions', () => ({
  getMicrosoftEmailSetupSigningSecret: (...args: unknown[]) => hoisted.getSigningSecret(...args),
  completeMicrosoftEmailApplicationCreation: (...args: unknown[]) => hoisted.complete(...args),
}));

vi.mock('@alga-psa/integrations/actions/integrations/microsoftActions', () => ({
  confirmMicrosoftEmailAdminConsentInternal: (...args: unknown[]) => hoisted.confirmConsent(...args),
}));

vi.mock('@alga-psa/integrations/lib/microsoftEmailSetup', () => ({
  validateMicrosoftEmailSetupState: (...args: unknown[]) => hoisted.validateState(...args),
}));

vi.mock('@alga-psa/integrations/utils/microsoftEmailSetupStateStore', () => ({
  consumeMicrosoftEmailSetupState: (...args: unknown[]) => hoisted.consumeState(...args),
}));

import { GET } from '../../../app/api/auth/microsoft/email-setup/callback/route';

/**
 * The route base64s a percent-encoded JSON payload (so accented Microsoft error
 * text survives the popup's latin-1 `atob`), and the first `atob(...)` literal
 * in the page is always the postMessage payload.
 */
function readPayload(html: string): string {
  return decodeURIComponent(
    Buffer.from(html.match(/atob\('([^']+)'\)/)?.[1] || '', 'base64').toString(),
  );
}

const createState = {
  purpose: 'create_application' as const,
  algaTenant: 'alga-tenant-1',
  userId: 'user-1',
  returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
  nonce: 'state-nonce',
  oauthNonce: 'oauth-nonce',
  issuedAt: 1,
  expiresAt: 2,
};

describe('Microsoft email setup callback', () => {
  beforeEach(() => {
    hoisted.getSigningSecret.mockReset().mockResolvedValue('signing-secret');
    hoisted.validateState.mockReset().mockReturnValue(createState);
    hoisted.getCurrentUser.mockReset().mockResolvedValue({
      tenant: 'alga-tenant-1',
      user_id: 'user-1',
    });
    hoisted.consumeState.mockReset().mockResolvedValue({ verifier: 'one-time-verifier' });
    hoisted.complete.mockReset().mockResolvedValue({ success: true, profileId: 'profile-1' });
    hoisted.confirmConsent.mockReset().mockResolvedValue({ success: true, profileId: 'profile-1' });
  });

  it('returns invalid setup attempts to the Providers integration route', async () => {
    const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    process.env.NEXT_PUBLIC_BASE_URL = 'https://psa.example.com';
    hoisted.validateState.mockReturnValue(null);
    try {
      const response = await GET(new NextRequest(
        'https://psa.example.com/api/auth/microsoft/email-setup/callback?state=invalid'
      ));
      const html = await response.text();

      expect(html).toContain(Buffer.from(
        'https://psa.example.com/msp/settings/integrations?category=providers'
      ).toString('base64'));
      expect(html).not.toContain(Buffer.from(
        'https://psa.example.com/msp/settings?category=providers'
      ).toString('base64'));
    } finally {
      if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
      else process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
    }
  });

  it('consumes the one-time verifier when Microsoft consent is denied', async () => {
    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=access_denied&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.consumeState).toHaveBeenCalledWith('state-nonce');
    expect(hoisted.complete).not.toHaveBeenCalled();
    expect(html).toContain('Microsoft Email Setup');
    expect(JSON.parse(readPayload(html))).toMatchObject({
      success: false,
      errorCode: 'consent_denied',
      error: expect.stringContaining('Microsoft sign-in or administrator consent was denied'),
    });
  });

  it('rejects a state/session tenant mismatch and consumes creation state', async () => {
    hoisted.getCurrentUser.mockResolvedValue({ tenant: 'another-tenant', user_id: 'user-1' });
    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?code=code&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.consumeState).toHaveBeenCalledWith('state-nonce');
    expect(hoisted.complete).not.toHaveBeenCalled();
    expect(JSON.parse(readPayload(html))).toMatchObject({
      success: false,
      errorCode: 'session_mismatch',
      error: expect.stringContaining('session does not match'),
    });
  });

  it('delegates a valid code to provisioning without exposing setup tokens', async () => {
    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?code=authorization-code&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.complete).toHaveBeenCalledWith({
      user: { tenant: 'alga-tenant-1', user_id: 'user-1' },
      state: createState,
      code: 'authorization-code',
    });
    expect(readPayload(html)).toContain('profile-1');
    expect(html).not.toContain('access_token');
    expect(html).not.toContain('one-time-verifier');
  });

  it('persists administrator consent before reporting setup completion', async () => {
    hoisted.validateState.mockReturnValue({
      ...createState,
      purpose: 'admin_consent',
      clientId: 'email-client-id',
      profileId: 'profile-1',
      oauthNonce: undefined,
    });

    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=true&tenant=microsoft-tenant&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.confirmConsent).toHaveBeenCalledWith(
      { tenant: 'alga-tenant-1', user_id: 'user-1' },
      'alga-tenant-1',
      {
        profileId: 'profile-1',
        clientId: 'email-client-id',
        microsoftTenantId: 'microsoft-tenant',
      }
    );
    expect(readPayload(html)).toContain('admin_consent');
  });

  it('does not advance setup when consent persistence fails', async () => {
    hoisted.validateState.mockReturnValue({
      ...createState,
      purpose: 'admin_consent',
      clientId: 'email-client-id',
      profileId: 'profile-1',
      oauthNonce: undefined,
    });
    hoisted.confirmConsent.mockResolvedValue({ success: false, error: 'Database unavailable' });

    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=true&tenant=microsoft-tenant&state=signed-state'
    ));
    const html = await response.text();

    expect(JSON.parse(readPayload(html))).toMatchObject({
      success: false,
      errorCode: 'consent_persist_failed',
      error: 'Database unavailable',
    });
    expect(readPayload(html)).not.toContain('"stage"');
    expect(readPayload(html)).not.toContain('admin_consent');
  });

  it('reports failures as stable codes rather than user-facing prose', async () => {
    hoisted.validateState.mockReturnValue(null);
    const invalid = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?state=invalid'
    ));
    expect(JSON.parse(readPayload(await invalid.text()))).toMatchObject({
      success: false,
      errorCode: 'invalid_state',
    });

    hoisted.validateState.mockReturnValue(createState);
    const noCode = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?state=signed-state'
    ));
    expect(JSON.parse(readPayload(await noCode.text()))).toMatchObject({
      success: false,
      errorCode: 'missing_code',
    });

    const unknownMicrosoftError = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=server_error&state=signed-state'
    ));
    expect(JSON.parse(readPayload(await unknownMicrosoftError.text()))).toMatchObject({
      success: false,
      errorCode: 'microsoft_error',
    });

    hoisted.validateState.mockReturnValue({
      ...createState,
      purpose: 'admin_consent',
      clientId: 'email-client-id',
      profileId: 'profile-1',
      oauthNonce: undefined,
    });
    const declined = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?admin_consent=false&state=signed-state'
    ));
    expect(JSON.parse(readPayload(await declined.text()))).toMatchObject({
      success: false,
      errorCode: 'consent_not_granted',
    });
  });
});
