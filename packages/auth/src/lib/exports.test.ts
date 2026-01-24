import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getUserRolesWithPermissions: vi.fn(async () => [])
  }
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} }))
}));

describe('auth package exports', () => {
  it('exports permission utilities from package root', async () => {
    process.env.NEXTAUTH_SECRET = 'test-secret';
    const auth = await import('@alga-psa/auth/rbac');
    expect(typeof auth.hasPermission).toBe('function');
    expect(typeof auth.checkMultiplePermissions).toBe('function');

    const user: any = {
      user_id: 'u1',
      username: 'u1',
      email: 'u1@example.com',
      hashed_password: 'hash',
      is_inactive: false,
      tenant: 'tenant-1',
      user_type: 'internal',
      created_at: new Date()
    };

    await expect(auth.hasPermission(user, 'client', 'read')).resolves.toBe(false);
  });
});
