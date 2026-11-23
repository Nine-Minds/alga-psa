import { describe, expect, it } from 'vitest';
import { projectCurrentUserForClient } from './currentUserProjection';

describe('projectCurrentUserForClient', () => {
  it('keeps session identity and permissions while excluding credential material', () => {
    const result = projectCurrentUserForClient({
      user_id: 'user-1',
      tenant: 'tenant-1',
      user_type: 'client',
      username: 'portal@example.test',
      email: 'portal@example.test',
      first_name: 'Portal',
      last_name: 'User',
      is_inactive: false,
      roles: [{ role_id: 'role-1', role_name: 'Portal', msp: false, client: true }],
      hashed_password: 'stored-hash',
      password: 'legacy-password',
      two_factor_secret: 'stored-secret',
    });

    expect(result).toMatchObject({ user_id: 'user-1', tenant: 'tenant-1', user_type: 'client', roles: [{ role_id: 'role-1' }] });
    expect(result).not.toHaveProperty('hashed_password');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('two_factor_secret');
  });
});
