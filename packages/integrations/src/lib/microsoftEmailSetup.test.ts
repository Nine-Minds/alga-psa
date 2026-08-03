import { describe, expect, it } from 'vitest';
import {
  buildMicrosoftEmailAdminConsentUrl,
  buildMicrosoftEmailApplicationManifest,
  createMicrosoftEmailSetupState,
  MICROSOFT_EMAIL_DELEGATED_PERMISSION_IDS,
  MICROSOFT_GRAPH_RESOURCE_APP_ID,
  validateMicrosoftEmailSetupState,
  validateMicrosoftTenantIdentifier,
} from './microsoftEmailSetup';

describe('Microsoft email setup builders', () => {
  it('builds a tenant-specific v2 admin consent URL with exact callback and state', () => {
    const url = new URL(buildMicrosoftEmailAdminConsentUrl({
      tenant: '11111111-2222-4333-8444-555555555555',
      clientId: 'client-id',
      redirectUri: 'https://psa.example.com/api/auth/microsoft/email-setup/callback',
      state: 'signed.state',
    }));

    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe('/11111111-2222-4333-8444-555555555555/v2.0/adminconsent');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://psa.example.com/api/auth/microsoft/email-setup/callback');
    expect(url.searchParams.get('state')).toBe('signed.state');
  });

  it('builds a multi-tenant application manifest with only the required read-only delegated permissions', () => {
    const manifest = buildMicrosoftEmailApplicationManifest({
      displayName: '  Alga   Email  ',
      mailboxRedirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
      setupRedirectUri: 'https://psa.example.com/api/auth/microsoft/email-setup/callback',
    });

    expect(manifest.displayName).toBe('Alga Email');
    expect(manifest.signInAudience).toBe('AzureADMultipleOrgs');
    expect(manifest.web.redirectUris).toEqual([
      'https://psa.example.com/api/auth/microsoft/callback',
      'https://psa.example.com/api/auth/microsoft/email-setup/callback',
    ]);
    expect(manifest.requiredResourceAccess).toEqual([{
      resourceAppId: MICROSOFT_GRAPH_RESOURCE_APP_ID,
      resourceAccess: [
        { id: MICROSOFT_EMAIL_DELEGATED_PERMISSION_IDS.mailRead, type: 'Scope' },
        { id: MICROSOFT_EMAIL_DELEGATED_PERMISSION_IDS.mailReadShared, type: 'Scope' },
        { id: MICROSOFT_EMAIL_DELEGATED_PERMISSION_IDS.offlineAccess, type: 'Scope' },
      ],
    }]);
    expect(JSON.stringify(manifest)).not.toContain('Mail.Send');
    expect(JSON.stringify(manifest)).not.toContain('Mail.ReadWrite');
  });

  it('signs expiring setup state and rejects tampering or expiry', () => {
    const created = createMicrosoftEmailSetupState({
      purpose: 'create_application',
      algaTenant: 'alga-tenant',
      userId: 'user-1',
      returnTo: 'https://psa.example.com/msp/settings/integrations?category=providers',
      displayName: 'Alga Email',
      includeOauthNonce: true,
      secret: 'test-signing-secret',
      ttlSeconds: 60,
    });

    expect(validateMicrosoftEmailSetupState({
      token: created.token,
      secret: 'test-signing-secret',
      now: created.payload.issuedAt + 30,
    })).toMatchObject({
      purpose: 'create_application',
      algaTenant: 'alga-tenant',
      userId: 'user-1',
      displayName: 'Alga Email',
    });
    expect(validateMicrosoftEmailSetupState({
      token: `${created.token}tampered`,
      secret: 'test-signing-secret',
    })).toBeNull();
    expect(validateMicrosoftEmailSetupState({
      token: created.token,
      secret: 'test-signing-secret',
      now: created.payload.expiresAt,
    })).toBeNull();
  });

  it('accepts tenant UUIDs and verified domains but rejects common and paths', () => {
    expect(validateMicrosoftTenantIdentifier('Contoso.onmicrosoft.com')).toBe('contoso.onmicrosoft.com');
    expect(validateMicrosoftTenantIdentifier('11111111-2222-4333-8444-555555555555')).toBe('11111111-2222-4333-8444-555555555555');
    expect(() => validateMicrosoftTenantIdentifier('common')).toThrow();
    expect(() => validateMicrosoftTenantIdentifier('contoso.com/path')).toThrow();
  });
});
