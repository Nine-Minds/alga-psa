import { describe, expect, it } from 'vitest';
import { generateMicrosoftAuthUrl } from '../../../utils/email/oauthHelpers';

describe('Microsoft outbound OAuth contract', () => {
  it('requests inbound, outbound, user, and offline access through the common authority', () => {
    const redirectUri = 'https://example.test/api/auth/microsoft/callback';
    const authUrl = new URL(generateMicrosoftAuthUrl('platform-client', redirectUri, {
      tenant: 'tenant-id',
      redirectUri,
      timestamp: Date.now(),
      nonce: 'nonce',
    }));

    expect(authUrl.origin).toBe('https://login.microsoftonline.com');
    expect(authUrl.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(new Set(authUrl.searchParams.get('scope')?.split(' '))).toEqual(new Set([
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.Read.Shared',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ]));
  });
});
