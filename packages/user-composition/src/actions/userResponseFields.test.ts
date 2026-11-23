import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getAuthenticatedCurrentUser: vi.fn(),
}));

vi.mock('@alga-psa/db/models/user', () => ({ default: { getAll: mocks.getAll } }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex, callback) => callback({})),
}));
vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: mocks.getAuthenticatedCurrentUser,
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => action(
    { user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal' },
    { tenant: 'tenant-1' },
    ...args,
  ),
  withOptionalAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => action(
    { user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal' },
    { tenant: 'tenant-1' },
    ...args,
  ),
}));
vi.mock('../lib/permissions', () => ({ hasPermission: vi.fn(async () => true) }));

import { getAllUsersBasic, getCurrentUser } from './userQueryActions';

describe('browser-facing user response fields', () => {
  const fixture = {
    user_id: 'user-1',
    username: 'profile.user',
    email: 'profile@example.test',
    first_name: 'Profile',
    last_name: 'User',
    phone: '+1 555 0100',
    phone_extension: '42',
    icon: 'avatar-reference-1',
    tenant: 'tenant-1',
    user_type: 'internal' as const,
    is_inactive: false,
    hashed_password: 'password-hash-canary',
    two_factor_secret: 'totp-secret-canary',
  };

  beforeEach(() => {
    mocks.getAll.mockReset();
    mocks.getAuthenticatedCurrentUser.mockReset();
  });

  it('preserves profile fields in directory responses while excluding credentials', async () => {
    mocks.getAll.mockResolvedValue([fixture]);

    const directory = await getAllUsersBasic();
    const response = directory[0];
    expect(response).toMatchObject({
      phone: fixture.phone,
      phone_extension: fixture.phone_extension,
      icon: fixture.icon,
    });
    expect(JSON.stringify(response)).not.toContain(fixture.hashed_password);
    expect(JSON.stringify(response)).not.toContain(fixture.two_factor_secret);
    expect(response).not.toHaveProperty('hashed_password');
    expect(response).not.toHaveProperty('two_factor_secret');
  });

  it('sanitizes credential canaries through the public current-user action while preserving profile fields', async () => {
    mocks.getAuthenticatedCurrentUser.mockResolvedValue(fixture);

    const response = await getCurrentUser();

    expect(mocks.getAuthenticatedCurrentUser).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      phone: fixture.phone,
      phone_extension: fixture.phone_extension,
      icon: fixture.icon,
    });
    expect(JSON.stringify(response)).not.toContain(fixture.hashed_password);
    expect(JSON.stringify(response)).not.toContain(fixture.two_factor_secret);
    expect(response).not.toHaveProperty('hashed_password');
    expect(response).not.toHaveProperty('two_factor_secret');
  });
});
