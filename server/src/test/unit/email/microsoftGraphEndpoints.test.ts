import { afterEach, describe, expect, it } from 'vitest';
import {
  ALGA_MICROSOFT_EMAIL_CLIENT_ID,
  getMicrosoftAuthorizeUrl,
  getMicrosoftGraphBaseUrl,
  getMicrosoftTokenUrl,
  resolveMicrosoftEmailOAuthAuthority,
} from '@alga-psa/shared/services/email/microsoftGraphEndpoints';

const originalGraphBaseUrl = process.env.MICROSOFT_GRAPH_BASE_URL;
const originalLoginBaseUrl = process.env.MICROSOFT_LOGIN_BASE_URL;

afterEach(() => {
  if (originalGraphBaseUrl === undefined) delete process.env.MICROSOFT_GRAPH_BASE_URL;
  else process.env.MICROSOFT_GRAPH_BASE_URL = originalGraphBaseUrl;
  if (originalLoginBaseUrl === undefined) delete process.env.MICROSOFT_LOGIN_BASE_URL;
  else process.env.MICROSOFT_LOGIN_BASE_URL = originalLoginBaseUrl;
});

describe('Microsoft endpoint overrides', () => {
  it('uses emulator base URLs without trailing slash duplication', () => {
    process.env.MICROSOFT_GRAPH_BASE_URL = 'http://graph-emulator:4010/v1.0/';
    process.env.MICROSOFT_LOGIN_BASE_URL = 'http://graph-emulator:4010/';

    expect(getMicrosoftGraphBaseUrl()).toBe('http://graph-emulator:4010/v1.0');
    expect(getMicrosoftAuthorizeUrl('common')).toBe(
      'http://graph-emulator:4010/common/oauth2/v2.0/authorize'
    );
    expect(getMicrosoftTokenUrl('tenant-id')).toBe(
      'http://graph-emulator:4010/tenant-id/oauth2/v2.0/token'
    );
  });
});

describe('Microsoft email OAuth authority selection', () => {
  it('uses common for the Alga-managed multi-tenant application', () => {
    expect(resolveMicrosoftEmailOAuthAuthority({
      clientId: ALGA_MICROSOFT_EMAIL_CLIENT_ID,
      tenantId: 'alga-home-tenant',
    })).toBe('common');
  });

  it('uses common when the resolver explicitly identifies platform credentials', () => {
    expect(resolveMicrosoftEmailOAuthAuthority({
      clientId: 'development-platform-client',
      tenantId: 'development-home-tenant',
      credentialSource: 'platform',
    })).toBe('common');
  });

  it('uses the configured directory for a tenant-provided application', () => {
    expect(resolveMicrosoftEmailOAuthAuthority({
      clientId: 'tenant-client-id',
      tenantId: '11111111-2222-4333-8444-555555555555',
      credentialSource: 'tenant',
    })).toBe('11111111-2222-4333-8444-555555555555');
  });

  it.each([undefined, '', 'common', 'organizations', 'consumers'])(
    'rejects non-concrete tenant authority %s for a tenant-provided application',
    (tenantId) => {
      expect(() => resolveMicrosoftEmailOAuthAuthority({
        clientId: 'tenant-client-id',
        tenantId,
        credentialSource: 'tenant',
      })).toThrow('A concrete Microsoft tenant ID is required');
    }
  );
});
