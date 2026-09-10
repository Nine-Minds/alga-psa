import { describe, expect, it } from 'vitest';
import { generateMicrosoftAuthUrl } from './oauthHelpers';

describe('Microsoft email OAuth scopes', () => {
  it('requests inbound read scopes, Mail.Send, Mail.Send.Shared, User.Read, and offline access', () => {
    const url = new URL(generateMicrosoftAuthUrl(
      'client-id',
      'https://app.example/api/auth/microsoft/callback',
      {
        tenant: 'tenant-1',
        redirectUri: 'https://app.example/api/auth/microsoft/callback',
        timestamp: Date.now(),
        nonce: 'nonce',
      }
    ));

    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.Read.Shared',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/Mail.Send.Shared',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ]);
    expect(url.searchParams.get('prompt')).toBe('consent');
  });
});
