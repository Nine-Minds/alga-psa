import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import type { IUserWithRoles } from '@alga-psa/types';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// getCurrentUser reads the session via the local ./getSession module, and
// reports a decoded-but-unresolvable session through the same module's
// rejection log, so that name has to be mocked too.
vi.mock('./getSession', () => ({
  getSession: vi.fn(),
  getSessionWithRevocationCheck: vi.fn(),
  logSessionRejection: vi.fn(),
}));

// User lookups now go through the @alga-psa/db helpers directly.
vi.mock('@alga-psa/db', () => ({
  getUserWithRoles: vi.fn(),
  getUserWithRolesByEmail: vi.fn(),
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  noteTenantProductCode: vi.fn(),
}));

import {
  getCurrentUser,
  getCurrentUserWithRevocationCheck,
} from './getCurrentUser';
import { getSession, getSessionWithRevocationCheck, logSessionRejection } from './getSession';
import { getUserWithRoles, noteTenantProductCode } from '@alga-psa/db';

const envSnapshot = { ...process.env };

beforeEach(() => {
  vi.mocked(getSession).mockReset();
  vi.mocked(getSessionWithRevocationCheck).mockReset();
  vi.mocked(getUserWithRoles).mockReset();
  vi.mocked(logSessionRejection).mockReset();
});

afterEach(() => {
  // Restore IN PLACE: modules that captured `process.env` by reference
  // (e.g. `import { env } from 'node:process'`) would keep reading the
  // old object if this reassigned process.env.
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
});

describe('getCurrentUser', () => {
  it('hands the session product code to write admission so a PSA request pays no tenants read', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'user-1', tenant: 'tenant-1', product_code: 'psa' },
    } as any);
    vi.mocked(getUserWithRoles).mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1', roles: [] } as any);

    await getCurrentUser();

    expect(vi.mocked(noteTenantProductCode)).toHaveBeenCalledWith('tenant-1', 'psa');
  });

  // Note: avatarUrl is intentionally NOT resolved by getCurrentUser anymore —
  // it caused a circular dependency with @alga-psa/documents. Callers needing
  // the avatar use getUserAvatarUrl separately.
  it('returns user with roles when session has id and tenant', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
      },
    } as any);

    vi.mocked(getUserWithRoles).mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
      roles: [{ role_id: 'role-1' }],
    } as any);

    const user = await getCurrentUser();

    expect(vi.mocked(getUserWithRoles)).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(user?.user_id).toBe('user-1');
    expect(user?.tenant).toBe('tenant-1');
    expect(user?.roles).toEqual([{ role_id: 'role-1' }]);
  });

  it('returns only allow-listed current-user data from credential-bearing lookup rows', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'user-1', tenant: 'tenant-1' },
    } as any);
    vi.mocked(getUserWithRoles).mockResolvedValue({
      user_id: 'user-1',
      username: 'alex',
      first_name: 'Alex',
      email: 'alex@example.com',
      phone_extension: '204',
      tenant: 'tenant-1',
      user_type: 'internal',
      is_inactive: false,
      hashed_password: 'password-hash-secret',
      two_factor_secret: 'totp-seed-secret',
      newly_added_database_column: 'must-not-escape',
      roles: [{ role_id: 'role-1', role_name: 'Technician', tenant: 'tenant-1' }],
    } as any);

    const user = await getCurrentUser();
    const serialized = JSON.stringify(user);

    expect(user).toMatchObject({
      user_id: 'user-1',
      username: 'alex',
      email: 'alex@example.com',
      phone_extension: '204',
      tenant: 'tenant-1',
      user_type: 'internal',
      roles: [{ role_id: 'role-1', role_name: 'Technician' }],
    });
    expect(user).not.toHaveProperty('hashed_password');
    expect(user).not.toHaveProperty('two_factor_secret');
    expect(user).not.toHaveProperty('newly_added_database_column');
    expect(serialized).not.toContain('password-hash-secret');
    expect(serialized).not.toContain('totp-seed-secret');
    expect(serialized).not.toContain('must-not-escape');
  });

  it('preserves phone extension and excludes non-allow-listed fields in revocation-checked responses', async () => {
    vi.mocked(getSessionWithRevocationCheck).mockResolvedValue({
      user: { id: 'user-1', tenant: 'tenant-1' },
    } as any);
    vi.mocked(getUserWithRoles).mockResolvedValue({
      user_id: 'user-1',
      phone_extension: '204',
      tenant: 'tenant-1',
      user_type: 'internal',
      is_inactive: false,
      hashed_password: 'revocation-password-hash',
      two_factor_secret: 'revocation-totp-seed',
      newly_added_database_column: 'revocation-unknown',
      roles: [{ role_id: 'role-1' }],
    } as any);

    const user = await getCurrentUserWithRevocationCheck();
    const serialized = JSON.stringify(user);

    expect(user?.phone_extension).toBe('204');
    expect(user).not.toHaveProperty('hashed_password');
    expect(user).not.toHaveProperty('two_factor_secret');
    expect(user).not.toHaveProperty('newly_added_database_column');
    expect(serialized).not.toContain('revocation-password-hash');
    expect(serialized).not.toContain('revocation-totp-seed');
    expect(serialized).not.toContain('revocation-unknown');
  });

  it('returns null when session is missing', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('returns null when the session user cannot be found', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
      },
    } as any);

    vi.mocked(getUserWithRoles).mockResolvedValue(null as any);

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(vi.mocked(logSessionRejection)).toHaveBeenCalledWith('user_missing');
  });

  it('returns null when the session user has been deactivated', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
      },
    } as any);

    vi.mocked(getUserWithRoles).mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
      is_inactive: true,
      roles: [{ role_id: 'role-1' }],
    } as any);

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('uses the full-auth-first resolver for authorization boundaries', async () => {
    vi.mocked(getSessionWithRevocationCheck).mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
      },
    } as unknown as Session);
    vi.mocked(getUserWithRoles).mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
      roles: [{ role_id: 'role-1' }],
    } as unknown as IUserWithRoles);

    await expect(getCurrentUserWithRevocationCheck()).resolves.toMatchObject({
      user_id: 'user-1',
      tenant: 'tenant-1',
    });
    expect(getSessionWithRevocationCheck).toHaveBeenCalledOnce();
    expect(getSession).not.toHaveBeenCalled();
  });
});
