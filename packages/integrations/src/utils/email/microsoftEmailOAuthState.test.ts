import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createMicrosoftEmailOAuthState,
  validateMicrosoftEmailOAuthState,
} from './microsoftEmailOAuthState';

const SECRET = 'test-signing-secret';

describe('Microsoft email OAuth signed state', () => {
  it('round-trips a valid signed state', () => {
    const { token, payload } = createMicrosoftEmailOAuthState({
      purpose: 'create',
      tenant: 'tenant-1',
      userId: 'user-1',
      providerId: 'provider-1',
      issuer: { kind: 'profile', profileId: 'profile-1', clientId: 'client-1' },
      clientId: 'client-1',
      redirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
      secret: SECRET,
    });

    expect(token).toContain('.');
    expect(payload).toMatchObject({
      purpose: 'create',
      tenant: 'tenant-1',
      userId: 'user-1',
      providerId: 'provider-1',
      issuerKind: 'profile',
      issuerProfileId: 'profile-1',
      clientId: 'client-1',
      redirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
    });

    const verified = validateMicrosoftEmailOAuthState({ token, secret: SECRET });
    expect(verified).toEqual(payload);
  });

  it('carries a managed issuer choice without a profile reference', () => {
    const { token } = createMicrosoftEmailOAuthState({
      purpose: 'reconnect',
      tenant: 'tenant-1',
      userId: 'user-1',
      issuer: { kind: 'managed', clientId: 'managed-client' },
      clientId: 'managed-client',
      redirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
      secret: SECRET,
    });

    const verified = validateMicrosoftEmailOAuthState({ token, secret: SECRET });
    expect(verified).toMatchObject({
      purpose: 'reconnect',
      issuerKind: 'managed',
      clientId: 'managed-client',
    });
  });

  it('rejects a tampered payload', () => {
    const { token } = createMicrosoftEmailOAuthState({
      purpose: 'create',
      tenant: 'tenant-1',
      userId: 'user-1',
      issuer: { kind: 'profile', profileId: 'profile-1', clientId: 'client-1' },
      clientId: 'client-1',
      redirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
      secret: SECRET,
    });

    const [payloadEncoded, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8')),
        clientId: 'attacker-client',
      })
    ).toString('base64url');

    expect(validateMicrosoftEmailOAuthState({ token: `${tamperedPayload}.${signature}`, secret: SECRET })).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = createMicrosoftEmailOAuthState({
      purpose: 'create',
      tenant: 'tenant-1',
      userId: 'user-1',
      issuer: { kind: 'managed', clientId: 'managed-client' },
      clientId: 'managed-client',
      redirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
      secret: SECRET,
    });

    expect(validateMicrosoftEmailOAuthState({ token, secret: 'other-secret' })).toBeNull();
  });

  it('rejects an expired token', () => {
    const { token } = createMicrosoftEmailOAuthState({
      purpose: 'create',
      tenant: 'tenant-1',
      userId: 'user-1',
      issuer: { kind: 'managed', clientId: 'managed-client' },
      clientId: 'managed-client',
      redirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
      secret: SECRET,
      ttlSeconds: 10,
    });

    expect(
      validateMicrosoftEmailOAuthState({
        token,
        secret: SECRET,
        now: Math.floor(Date.now() / 1000) + 11,
      })
    ).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(validateMicrosoftEmailOAuthState({ token: 'not-a-token', secret: SECRET })).toBeNull();
    expect(validateMicrosoftEmailOAuthState({ token: null, secret: SECRET })).toBeNull();
    expect(validateMicrosoftEmailOAuthState({ token: 'abc.def.ghi', secret: SECRET })).toBeNull();
  });
});
