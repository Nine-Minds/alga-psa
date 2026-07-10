import { vi } from 'vitest';
import { IUserWithRoles } from '../src/interfaces/auth.interfaces';

// Shared mutable state driving both the auth-module mock below and the
// reprogramming helpers in testMocks.ts (setMockUser, mockRBAC, ...).
//
// This module must NEVER import '@alga-psa/auth' (directly or transitively).
// vi.mock('@alga-psa/auth') factories dynamically import this file; if it
// imported the module being mocked, the factory would await its own pending
// evaluation and vitest would deadlock silently before running a single test
// (55-minute hangs in CI with no output past the RUN banner). For the same
// reason, factories must import THIS file, not testMocks.ts — testMocks
// statically imports '@alga-psa/auth'.

export const currentUserRef = {
  user: {
    user_id: 'mock-user-id',
    tenant: '11111111-1111-1111-1111-111111111111',
    username: 'mock-user',
    first_name: 'Mock',
    last_name: 'User',
    email: 'mock.user@example.com',
    hashed_password: 'hashed_password_here',
    is_inactive: false,
    user_type: 'internal',
    roles: []
  } as IUserWithRoles
};

export const sessionUserRef = {
  user: {
    id: 'mock-user-id',
    tenant: '11111111-1111-1111-1111-111111111111'
  }
};

export const permissionRef = {
  value: ['user_schedule:update', 'user_schedule:read'] as string[]
};

export const permissionCheckRef = {
  fn: (user: IUserWithRoles, resource?: string, action?: string) =>
    user.roles?.some(role => role.role_name.toLowerCase() === 'admin') ?? true
};

/**
 * Complete mock for the bare `@alga-psa/auth` module. Server actions wrapped in
 * withAuth(...) (and friends) throw at import time when a test mocks
 * @alga-psa/auth without these exports. Returns faithful pass-throughs wired to
 * the same currentUserRef / permissionCheckRef the testMocks helpers drive, so
 * setupCommonMocks / mockRBAC / setMockUser keep controlling auth and permission.
 *
 * Use via dynamic import of THIS module (never testMocks — see header comment):
 *
 *   vi.mock('@alga-psa/auth', async () => {
 *     const { createAuthModuleMock } = await import('<rel>/authModuleMock');
 *     return createAuthModuleMock();
 *   });
 */
export function createAuthModuleMock() {
  const getCurrentUser = vi.fn(async () => currentUserRef.user);
  const hasPermission = vi.fn((user: IUserWithRoles, resource?: string, action?: string) =>
    Promise.resolve(permissionCheckRef.fn(user, resource, action))
  );
  const getSession = vi.fn(async () =>
    currentUserRef.user
      ? { user: { id: currentUserRef.user.user_id, tenant: currentUserRef.user.tenant } }
      : null
  );
  const requireUser = async () => {
    const user = await getCurrentUser();
    if (!user) throw new Error('Authentication required');
    return user;
  };
  return {
    getSession,
    getCurrentUser,
    hasPermission,
    withAuth: (action: (...a: any[]) => any) => async (...args: any[]) => {
      const user = await requireUser();
      return action(user, { tenant: user.tenant }, ...args);
    },
    withOptionalAuth: (action: (...a: any[]) => any) => async (...args: any[]) => {
      const user = await getCurrentUser();
      return action(user ?? null, user ? { tenant: user.tenant } : null, ...args);
    },
    withAuthCheck: (action: (...a: any[]) => any) => async (...args: any[]) => {
      const user = await requireUser();
      return action(user, ...args);
    },
  };
}
