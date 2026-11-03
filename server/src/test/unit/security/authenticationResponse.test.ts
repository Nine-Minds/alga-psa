import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), verify: vi.fn() }));
vi.mock('@alga-psa/db/models/user', () => ({ default: { findUserByEmailTenantAndType: mocks.lookup } }));
vi.mock('@alga-psa/db', () => ({ getTenantIdBySlug: vi.fn() }));
vi.mock('@alga-psa/core/encryption', () => ({ verifyPassword: mocks.verify }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));

import { authenticateUser } from '../../../../../packages/auth/src/actions/auth';
import { authenticateUserForAuth } from '../../../../../packages/auth/src/lib/authenticateUserForAuth';

const fullUser = {
  user_id: 'user-a', username: 'alice', email: 'alice@example.test', tenant: 'tenant-a',
  user_type: 'internal', is_inactive: false, hashed_password: 'PRIVATE_PASSWORD_HASH',
  two_factor_enabled: true, two_factor_secret: 'PRIVATE_TOTP_SEED',
};
const credentials = ['alice@example.test', 'password', 'internal', { tenantId: 'tenant-a' }] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue(fullUser);
  mocks.verify.mockResolvedValue(true);
});

describe('authentication credential boundary', () => {
  it('retains credentials for the server-only NextAuth second-factor path', async () => {
    const result = await authenticateUserForAuth(...credentials);
    expect(result).toEqual(fullUser);
    expect(mocks.verify).toHaveBeenCalledWith('password', 'PRIVATE_PASSWORD_HASH');
    expect(mocks.lookup).toHaveBeenCalledWith('alice@example.test', 'tenant-a', 'internal');
  });

  it('returns only public fields from the authentication server action', async () => {
    const result = await authenticateUser(...credentials);
    expect(result).toMatchObject({ user_id: 'user-a', two_factor_enabled: true });
    expect(result).not.toHaveProperty('hashed_password');
    expect(result).not.toHaveProperty('two_factor_secret');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(fullUser.two_factor_secret).toBe('PRIVATE_TOTP_SEED');
  });

  it('preserves invalid-password and inactive-user refusals', async () => {
    mocks.verify.mockResolvedValue(false);
    expect(await authenticateUserForAuth(...credentials)).toBeNull();
    expect(await authenticateUser(...credentials)).toBeNull();
    mocks.verify.mockResolvedValue(true);
    mocks.lookup.mockResolvedValue({ ...fullUser, is_inactive: true });
    expect(await authenticateUserForAuth(...credentials)).toBeNull();
    expect(await authenticateUser(...credentials)).toBeNull();
  });
});
