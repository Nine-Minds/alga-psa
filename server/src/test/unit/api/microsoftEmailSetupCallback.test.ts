import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getSigningSecret: vi.fn(),
  validateState: vi.fn(),
  consumeState: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => hoisted.getCurrentUser(...args),
}));

vi.mock('@alga-psa/integrations/actions/integrations/microsoftEmailSetupActions', () => ({
  getMicrosoftEmailSetupSigningSecret: (...args: unknown[]) => hoisted.getSigningSecret(...args),
  completeMicrosoftEmailApplicationCreation: (...args: unknown[]) => hoisted.complete(...args),
}));

vi.mock('@alga-psa/integrations/lib/microsoftEmailSetup', () => ({
  validateMicrosoftEmailSetupState: (...args: unknown[]) => hoisted.validateState(...args),
}));

vi.mock('@alga-psa/integrations/utils/microsoftEmailSetupStateStore', () => ({
  consumeMicrosoftEmailSetupState: (...args: unknown[]) => hoisted.consumeState(...args),
}));

import { GET } from '../../../app/api/auth/microsoft/email-setup/callback/route';

const createState = {
  purpose: 'create_application' as const,
  algaTenant: 'alga-tenant-1',
  userId: 'user-1',
  returnTo: 'https://psa.example.com/msp/settings?category=providers',
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
  });

  it('consumes the one-time verifier when Microsoft consent is denied', async () => {
    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?error=access_denied&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.consumeState).toHaveBeenCalledWith('state-nonce');
    expect(hoisted.complete).not.toHaveBeenCalled();
    expect(html).toContain('Microsoft Email Setup');
    expect(Buffer.from(html.match(/atob\('([^']+)'\)/)?.[1] || '', 'base64').toString()).toContain(
      'Microsoft sign-in or administrator consent was denied'
    );
  });

  it('rejects a state/session tenant mismatch and consumes creation state', async () => {
    hoisted.getCurrentUser.mockResolvedValue({ tenant: 'another-tenant', user_id: 'user-1' });
    const response = await GET(new NextRequest(
      'https://psa.example.com/api/auth/microsoft/email-setup/callback?code=code&state=signed-state'
    ));
    const html = await response.text();

    expect(hoisted.consumeState).toHaveBeenCalledWith('state-nonce');
    expect(hoisted.complete).not.toHaveBeenCalled();
    expect(Buffer.from(html.match(/atob\('([^']+)'\)/)?.[1] || '', 'base64').toString()).toContain(
      'session does not match'
    );
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
    expect(Buffer.from(html.match(/atob\('([^']+)'\)/)?.[1] || '', 'base64').toString()).toContain('profile-1');
    expect(html).not.toContain('access_token');
    expect(html).not.toContain('one-time-verifier');
  });
});
