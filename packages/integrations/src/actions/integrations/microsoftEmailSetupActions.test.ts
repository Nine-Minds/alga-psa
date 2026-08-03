import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalGraphBaseUrl = process.env.MICROSOFT_GRAPH_BASE_URL;
const originalLoginBaseUrl = process.env.MICROSOFT_LOGIN_BASE_URL;

const hoisted = vi.hoisted(() => ({
  user: { user_id: 'user-1', user_type: 'internal' } as any,
  ctx: { tenant: 'alga-tenant-1' },
  permission: true,
  appSecrets: new Map<string, string>(),
  consumeState: vi.fn(),
  storeState: vi.fn(),
  persistProfile: vi.fn(),
  axiosPost: vi.fn(),
  axiosRequest: vi.fn(),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) => action(hoisted.user, hoisted.ctx, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => hoisted.permission),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async (name: string) => hoisted.appSecrets.get(name) || null,
  })),
}));

vi.mock('../../utils/microsoftEmailSetupStateStore', () => ({
  consumeMicrosoftEmailSetupState: (...args: unknown[]) => hoisted.consumeState(...args),
  storeMicrosoftEmailSetupState: (...args: unknown[]) => hoisted.storeState(...args),
}));

vi.mock('./microsoftActions', () => ({
  getMicrosoftEmailSetupMetadataInternal: vi.fn(async () => ({
    baseUrl: 'https://psa.example.com',
    mailboxRedirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
    setupRedirectUri: 'https://psa.example.com/api/auth/microsoft/email-setup/callback',
    returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
  })),
  createMicrosoftEmailProfilePendingConsentInternal: (...args: unknown[]) => hoisted.persistProfile(...args),
}));

vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => hoisted.axiosPost(...args),
    request: (...args: unknown[]) => hoisted.axiosRequest(...args),
    isAxiosError: (error: unknown) => Boolean((error as any)?.isAxiosError),
  },
}));

import {
  completeMicrosoftEmailApplicationCreation,
  createMicrosoftEmailApplication,
  getMicrosoftEmailSetupOptions,
  configureMicrosoftEmailPlatformApplication,
} from './microsoftEmailSetupActions';

function jwt(payload: Record<string, unknown>): string {
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('Microsoft email setup actions', () => {
  beforeEach(() => {
    hoisted.permission = true;
    hoisted.appSecrets.clear();
    hoisted.appSecrets.set('NEXTAUTH_SECRET', 'test-signing-secret');
    hoisted.appSecrets.set('MICROSOFT_CLIENT_ID', 'platform-client-id');
    hoisted.appSecrets.set('MICROSOFT_CLIENT_SECRET', 'platform-client-secret');
    hoisted.consumeState.mockReset();
    hoisted.storeState.mockReset().mockResolvedValue(undefined);
    hoisted.persistProfile.mockReset().mockResolvedValue({
      success: true,
      profileId: 'profile-1',
      displayName: 'Alga Email',
    });
    hoisted.axiosPost.mockReset();
    hoisted.axiosRequest.mockReset();
  });

  afterEach(() => {
    if (originalGraphBaseUrl === undefined) delete process.env.MICROSOFT_GRAPH_BASE_URL;
    else process.env.MICROSOFT_GRAPH_BASE_URL = originalGraphBaseUrl;
    if (originalLoginBaseUrl === undefined) delete process.env.MICROSOFT_LOGIN_BASE_URL;
    else process.env.MICROSOFT_LOGIN_BASE_URL = originalLoginBaseUrl;
  });

  it('guards setup metadata with system settings update permission', async () => {
    hoisted.permission = false;
    await expect(getMicrosoftEmailSetupOptions()).resolves.toEqual({ success: false, error: 'Forbidden' });
  });

  it('starts automated creation with one-time PKCE state and no verifier in the browser result', async () => {
    const result = await createMicrosoftEmailApplication({ displayName: 'Alga Email' });

    expect(result.success).toBe(true);
    expect(result.authUrl).toContain('code_challenge_method=S256');
    expect(result.authUrl).toContain('Application.ReadWrite.All');
    expect(result).not.toHaveProperty('verifier');
    expect(hoisted.storeState).toHaveBeenCalledOnce();
    expect(hoisted.storeState.mock.calls[0][1]).toMatchObject({
      algaTenant: 'alga-tenant-1',
      userId: 'user-1',
    });
  });

  it('stores the platform secret only through profile persistence and never returns it', async () => {
    const result = await configureMicrosoftEmailPlatformApplication({
      tenantId: '11111111-2222-4333-8444-555555555555',
      displayName: 'Platform Email',
    });

    expect(hoisted.persistProfile).toHaveBeenCalledWith(
      hoisted.user,
      'alga-tenant-1',
      expect.objectContaining({ clientSecret: 'platform-client-secret' })
    );
    expect(JSON.stringify(result)).not.toContain('platform-client-secret');
    expect(result).toMatchObject({ success: true, profileId: 'profile-1' });
  });

  it('creates Graph objects, persists the generated secret server-side, and sanitizes the result', async () => {
    process.env.MICROSOFT_GRAPH_BASE_URL = 'http://graph-emulator:4010/v1.0/';
    process.env.MICROSOFT_LOGIN_BASE_URL = 'http://graph-emulator:4010/';
    const tenantId = '11111111-2222-4333-8444-555555555555';
    hoisted.consumeState.mockResolvedValue({
      verifier: 'pkce-verifier',
      algaTenant: 'alga-tenant-1',
      userId: 'user-1',
      oauthNonce: 'oauth-nonce',
    });
    hoisted.axiosPost.mockResolvedValue({
      data: {
        access_token: jwt({
          tid: tenantId,
          iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
          scp: 'Application.ReadWrite.All',
        }),
        id_token: jwt({ nonce: 'oauth-nonce' }),
      },
    });
    hoisted.axiosRequest
      .mockResolvedValueOnce({ data: { id: 'application-object-id', appId: 'new-client-id', displayName: 'Alga Email' } })
      .mockResolvedValueOnce({ data: { id: 'service-principal-id', appId: 'new-client-id' } })
      .mockResolvedValueOnce({ data: { secretText: 'generated-secret-value' } });

    const result = await completeMicrosoftEmailApplicationCreation({
      user: hoisted.user,
      code: 'authorization-code',
      state: {
        purpose: 'create_application',
        algaTenant: 'alga-tenant-1',
        userId: 'user-1',
        returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
        nonce: 'state-nonce',
        oauthNonce: 'oauth-nonce',
        displayName: 'Alga Email',
        issuedAt: 1,
        expiresAt: 2,
      },
    });

    expect(hoisted.axiosPost.mock.calls[0][0]).toBe(
      'http://graph-emulator:4010/common/oauth2/v2.0/token'
    );
    expect(hoisted.axiosRequest.mock.calls.map(([request]) => request.url)).toEqual([
      'http://graph-emulator:4010/v1.0/applications',
      'http://graph-emulator:4010/v1.0/servicePrincipals',
      'http://graph-emulator:4010/v1.0/applications/application-object-id/addPassword',
    ]);
    expect(hoisted.persistProfile).toHaveBeenCalledWith(
      hoisted.user,
      'alga-tenant-1',
      expect.objectContaining({
        clientId: 'new-client-id',
        clientSecret: 'generated-secret-value',
        tenantId,
      })
    );
    expect(result).toMatchObject({ success: true, profileId: 'profile-1', clientId: 'new-client-id', tenantId });
    expect(JSON.stringify(result)).not.toContain('generated-secret-value');
    expect(JSON.stringify(result)).not.toContain('access_token');
  });

  it('consumes setup state once and performs compensating Graph cleanup after a partial failure', async () => {
    const tenantId = '11111111-2222-4333-8444-555555555555';
    hoisted.consumeState.mockResolvedValue({
      verifier: 'pkce-verifier',
      algaTenant: 'alga-tenant-1',
      userId: 'user-1',
      oauthNonce: 'oauth-nonce',
    });
    hoisted.axiosPost.mockResolvedValue({
      data: {
        access_token: jwt({ tid: tenantId, iss: `https://sts.windows.net/${tenantId}/`, scp: 'Application.ReadWrite.All' }),
        id_token: jwt({ nonce: 'oauth-nonce' }),
      },
    });
    hoisted.axiosRequest
      .mockResolvedValueOnce({ data: { id: 'application-object-id', appId: 'new-client-id', displayName: 'Alga Email' } })
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 403, data: { error: { code: 'Authorization_RequestDenied' } } } })
      .mockResolvedValueOnce({ data: undefined });

    const state = {
      purpose: 'create_application' as const,
      algaTenant: 'alga-tenant-1',
      userId: 'user-1',
      returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
      nonce: 'state-nonce',
      oauthNonce: 'oauth-nonce',
      displayName: 'Alga Email',
      issuedAt: 1,
      expiresAt: 2,
    };
    const result = await completeMicrosoftEmailApplicationCreation({ user: hoisted.user, code: 'code', state });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Microsoft denied permission');
    expect(hoisted.axiosRequest.mock.calls.at(-1)?.[0]).toMatchObject({
      method: 'DELETE',
      url: 'https://graph.microsoft.com/v1.0/applications/application-object-id',
    });

    hoisted.consumeState.mockResolvedValueOnce(null);
    await expect(completeMicrosoftEmailApplicationCreation({ user: hoisted.user, code: 'code', state }))
      .resolves.toEqual({
        success: false,
        error: 'This Microsoft setup request is invalid, expired, or has already been used.',
      });
  });
});
