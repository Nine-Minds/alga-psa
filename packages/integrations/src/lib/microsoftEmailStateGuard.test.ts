import { describe, expect, it } from 'vitest';

import {
  MICROSOFT_EMAIL_ISSUER_ERRORS,
} from './microsoftEmailIssuerSelection';
import {
  verifyMicrosoftEmailOAuthStateRelationships,
  type MicrosoftEmailStateProviderContext,
} from './microsoftEmailStateGuard';
import type { MicrosoftEmailOAuthStatePayload } from '../utils/email/microsoftEmailOAuthState';

function signedPayload(overrides: Partial<MicrosoftEmailOAuthStatePayload> = {}): MicrosoftEmailOAuthStatePayload {
  return {
    purpose: 'create',
    tenant: 'tenant-1',
    userId: 'user-1',
    issuerKind: 'managed',
    clientId: 'managed-client',
    redirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
    nonce: 'nonce-1',
    issuedAt: 1700000000,
    expiresAt: 1700000600,
    ...overrides,
  };
}

function sessionUser(overrides: Record<string, unknown> = {}) {
  return { user_id: 'user-1', tenant: 'tenant-1', ...overrides };
}

function provider(overrides: Partial<MicrosoftEmailStateProviderContext> = {}): MicrosoftEmailStateProviderContext {
  return {
    id: 'provider-1',
    tenant: 'tenant-1',
    provider_type: 'microsoft',
    refresh_token: null,
    status: 'configuring',
    ...overrides,
  };
}

describe('verifyMicrosoftEmailOAuthStateRelationships', () => {
  it('accepts a create state for a brand-new provider row (no refresh token yet)', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'create', providerId: 'provider-1' }),
      sessionUser: sessionUser(),
      provider: provider({ refresh_token: null, status: 'configuring' }),
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects a create state that would overwrite an already-connected provider', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'create', providerId: 'provider-1' }),
      sessionUser: sessionUser(),
      provider: provider({ refresh_token: 'old-refresh-token', status: 'connected' }),
    });

    expect(result).toMatchObject({
      ok: false,
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_PURPOSE_MISMATCH,
    });
  });

  it('rejects a reconnect state that carries no providerId', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect' }),
      sessionUser: sessionUser(),
      provider: null,
    });

    expect(result).toMatchObject({
      ok: false,
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_PURPOSE_MISMATCH,
    });
  });

  it('accepts a reconnect state for an existing connected provider', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: 'provider-1' }),
      sessionUser: sessionUser(),
      provider: provider({ refresh_token: 'old-refresh-token', status: 'connected' }),
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects when the session user differs from the user signed into the state', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: 'provider-1' }),
      sessionUser: sessionUser({ user_id: 'attacker-user' }),
      provider: provider(),
    });

    expect(result).toMatchObject({
      ok: false,
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_USER_MISMATCH,
    });
  });

  it('rejects a state naming a provider that no longer exists', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: 'provider-gone' }),
      sessionUser: sessionUser(),
      provider: null,
    });

    expect(result).toMatchObject({
      ok: false,
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_NOT_FOUND,
    });
  });

  it('rejects a state naming a provider from another tenant', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: 'provider-1' }),
      sessionUser: sessionUser(),
      provider: provider({ tenant: 'other-tenant' }),
    });

    expect(result).toMatchObject({
      ok: false,
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_TENANT_MISMATCH,
    });
  });

  it('rejects a state naming a non-Microsoft provider', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: 'provider-1' }),
      sessionUser: sessionUser(),
      provider: provider({ provider_type: 'google' }),
    });

    expect(result).toMatchObject({
      ok: false,
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_TYPE_NOT_SUPPORTED,
    });
  });

  it('rejects a state consumed by a session with no matching tenant', () => {
    const result = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'create', providerId: 'provider-1' }),
      sessionUser: null,
      provider: provider(),
    });

    expect(result).toMatchObject({
      ok: false,
      code: MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE,
    });
  });

  it('returns a distinguishable code for each rejection', () => {
    const codes = [
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'create', providerId: 'p' }),
        sessionUser: sessionUser(),
        provider: provider({ refresh_token: 'x' }),
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: 'p' }),
        sessionUser: sessionUser({ user_id: 'other' }),
        provider: provider(),
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: 'p' }),
        sessionUser: sessionUser(),
        provider: null,
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: 'p' }),
        sessionUser: sessionUser(),
        provider: provider({ tenant: 'other' }),
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: 'p' }),
        sessionUser: sessionUser(),
        provider: provider({ provider_type: 'google' }),
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'create', providerId: 'p' }),
        sessionUser: null,
        provider: provider(),
      }),
    ].map((r) => (r.ok ? 'ok' : r.code));

    expect(new Set(codes).size).toBe(codes.length);
  });
});
