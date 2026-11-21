// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), verify: vi.fn() }));
vi.mock('@alga-psa/db/models/user', () => ({ default: { findUserByEmailTenantAndType: mocks.lookup } }));
vi.mock('@alga-psa/db', () => ({ getTenantIdBySlug: vi.fn() }));
vi.mock('@alga-psa/core/encryption', () => ({ verifyPassword: mocks.verify }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));

// Component suites load server actions directly: Vitest does not replace them
// with Next.js RPC proxies. Keep the action and its server-only helper real.
import { authenticateUser } from '../../auth/src/actions/auth';

const storedUser = {
  user_id: 'user-a', username: 'alice', email: 'alice@example.test', tenant: 'tenant-a',
  user_type: 'internal', is_inactive: false, two_factor_enabled: true,
  hashed_password: 'PRIVATE_HASH', two_factor_secret: 'PRIVATE_TOTP',
};
const credentials = [
  'alice@example.test', 'password', 'internal',
  { tenantId: 'tenant-a', purpose: 'reauthenticate' },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue(storedUser);
  mocks.verify.mockResolvedValue(true);
});

describe('server action execution in the component test runtime', () => {
  it('verifies credentials on the server and returns only public user fields', async () => {
    expect(await authenticateUser(...credentials)).toEqual({
      user_id: 'user-a', username: 'alice', email: 'alice@example.test', tenant: 'tenant-a',
      user_type: 'internal', is_inactive: false, two_factor_enabled: true,
    });
    expect(mocks.lookup).toHaveBeenCalledWith('alice@example.test', 'tenant-a', 'internal');
    expect(mocks.verify).toHaveBeenCalledWith('password', 'PRIVATE_HASH');
    expect(storedUser.two_factor_secret).toBe('PRIVATE_TOTP');
  });

  it('rejects an invalid password without returning a user', async () => {
    mocks.verify.mockResolvedValue(false);
    expect(await authenticateUser(...credentials)).toBeNull();
  });
});
