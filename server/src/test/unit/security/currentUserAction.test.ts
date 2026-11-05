import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock('@alga-psa/auth', () => auth);

import { getCurrentUser } from '@alga-psa/user-composition/actions/currentUserAction';

describe('browser current-user action', () => {
  beforeEach(() => auth.getCurrentUser.mockReset());

  it('returns identity and roles without password or TOTP credentials', async () => {
    const passwordCanary = 'credential-canary-password-hash';
    const totpCanary = 'credential-canary-totp-seed';
    auth.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      username: 'current.user',
      email: 'current@example.test',
      first_name: 'Current',
      last_name: 'User',
      tenant: 'tenant-1',
      user_type: 'internal',
      is_inactive: false,
      hashed_password: passwordCanary,
      two_factor_secret: totpCanary,
      roles: [{ role_id: 'role-1', role_name: 'Dispatcher', msp: true, client: false }],
    });

    const result = await getCurrentUser();
    const payload = JSON.stringify(result);

    if (result === null) {
      throw new Error('Expected an authenticated current user');
    }

    expect(result).toMatchObject({
      user_id: 'user-1',
      email: 'current@example.test',
      tenant: 'tenant-1',
      roles: [{ role_id: 'role-1', role_name: 'Dispatcher' }],
    });
    expect(Object.hasOwn(result, 'hashed_password')).toBe(false);
    expect(Object.hasOwn(result, 'password_hash')).toBe(false);
    expect(Object.hasOwn(result, 'two_factor_secret')).toBe(false);
    expect(Object.hasOwn(result, 'totp_seed')).toBe(false);
    expect(payload.includes(passwordCanary)).toBe(false);
    expect(payload.includes(totpCanary)).toBe(false);
  });

  it('preserves unauthenticated behavior', async () => {
    auth.getCurrentUser.mockResolvedValue(null);

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
