import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import speakeasy from 'speakeasy';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(), verifyPassword: vi.fn(), auth: vi.fn(), permission: vi.fn(),
  setCookie: vi.fn(), policy: vi.fn(),
}));
vi.mock('@alga-psa/db/models/user', () => ({ default: { findUserByEmailTenantAndType: mocks.lookup } }));
vi.mock('@alga-psa/db', () => ({ getTenantIdBySlug: vi.fn() }));
vi.mock('@alga-psa/core/encryption', () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));
vi.mock('@alga-psa/auth/lib/authPolicyStore', () => ({ loadTenantAuthPolicy: mocks.policy }));
vi.mock('server/src/app/api/auth/[...nextauth]/auth', () => ({ auth: mocks.auth }));
vi.mock('@ee/lib/actions/auth/ssoPermissions', () => ({ ensureSsoSettingsPermission: mocks.permission }));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTierAccess: vi.fn() }));
vi.mock('server/src/lib/auth/sessionCookies', () => ({ getNextAuthSecret: async () => 'link-signing-secret' }));
vi.mock('next/headers.js', () => ({ cookies: async () => ({ set: mocks.setCookie }) }));

import { authorizeSsoLinkingAction } from '@ee/lib/actions/auth/connectSso';

const fullUser = {
  user_id: 'user-a', username: 'alice', email: 'alice@example.test', tenant: 'tenant-a',
  user_type: 'internal', is_inactive: false, hashed_password: 'PRIVATE_PASSWORD_HASH',
  two_factor_enabled: true, two_factor_secret: 'JBSWY3DPEHPK3PXP',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({ ...fullUser });
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.auth.mockResolvedValue({ user: {
    id: fullUser.user_id, email: fullUser.email, tenant: fullUser.tenant, user_type: fullUser.user_type,
  } });
  mocks.permission.mockResolvedValue({ user: { user_id: fullUser.user_id }, tenant: fullUser.tenant });
});

afterEach(() => vi.useRealTimers());

describe('SSO linking credential boundary', () => {
  it('verifies a real TOTP and returns only linking state, keeping credentials server-side', async () => {
    const twoFactorCode = speakeasy.totp({ secret: fullUser.two_factor_secret, encoding: 'base32' });
    const result = await authorizeSsoLinkingAction({ password: 'password', twoFactorCode });

    expect(result).toEqual({
      success: true, nonce: expect.any(String), nonceIssuedAt: expect.any(Number),
      nonceSignature: expect.any(String), requiresTwoFactor: true,
    });
    expect(mocks.lookup).toHaveBeenCalledWith(fullUser.email, fullUser.tenant, 'internal');
    expect(mocks.verifyPassword).toHaveBeenCalledWith('password', fullUser.hashed_password);
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.setCookie).toHaveBeenCalledOnce();
    const cookie = mocks.setCookie.mock.calls[0][0];
    expect(cookie.httpOnly).toBe(true);
    expect(JSON.parse(Buffer.from(cookie.value, 'base64url').toString())).toEqual({
      userId: fullUser.user_id, nonce: result.nonce,
      issuedAt: result.nonceIssuedAt, signature: result.nonceSignature,
    });
    expect(JSON.stringify(result)).not.toContain(fullUser.two_factor_secret);
    expect(JSON.stringify(result)).not.toContain(fullUser.hashed_password);
  });

  it.each([undefined, '', '   '])('requires a second factor when the code is %j', async (twoFactorCode) => {
    expect(await authorizeSsoLinkingAction({ password: 'password', twoFactorCode })).toEqual({
      success: false, error: 'Two-factor authentication code is required.', requiresTwoFactor: true,
    });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('rejects an invalid second factor without issuing linking state', async () => {
    expect(await authorizeSsoLinkingAction({ password: 'password', twoFactorCode: 'invalid' })).toEqual({
      success: false, error: 'Invalid two-factor authentication code.', requiresTwoFactor: true,
    });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('fails closed when 2FA is enabled but its stored secret is missing', async () => {
    mocks.lookup.mockResolvedValue({ ...fullUser, two_factor_secret: null });
    expect(await authorizeSsoLinkingAction({ password: 'password', twoFactorCode: '123456' })).toEqual({
      success: false, error: 'Two-factor authentication is misconfigured for this account.', requiresTwoFactor: true,
    });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('rejects an invalid password without issuing linking state', async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    expect(await authorizeSsoLinkingAction({ password: 'wrong' })).toEqual({
      success: false, error: 'Invalid email or password.',
    });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('permits password-only reauthentication when 2FA is disabled', async () => {
    mocks.lookup.mockResolvedValue({ ...fullUser, two_factor_enabled: false, two_factor_secret: null });
    expect(await authorizeSsoLinkingAction({ password: 'password' })).toMatchObject({
      success: true, requiresTwoFactor: false,
    });
    expect(mocks.setCookie).toHaveBeenCalledOnce();
  });
});
