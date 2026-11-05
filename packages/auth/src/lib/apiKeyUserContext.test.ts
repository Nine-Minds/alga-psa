import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const db = vi.hoisted(() => ({
  runWithTenant: vi.fn(),
  getUserWithRoles: vi.fn(),
  getUserWithRolesByEmail: vi.fn(),
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: db.runWithTenant,
  getUserWithRoles: db.getUserWithRoles,
  getUserWithRolesByEmail: db.getUserWithRolesByEmail,
  createTenantKnex: db.createTenantKnex,
}));

const session = vi.hoisted(() => ({
  getSessionWithRevocationCheck: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('./getSession', () => ({
  getSession: session.getSession,
  getSessionWithRevocationCheck: session.getSessionWithRevocationCheck,
}));

import { runWithApiKeyUser } from './apiKeyUserContext';
import { withAuth } from './withAuth';
import { getCurrentUser } from './getCurrentUser';

const apiKeyUser = {
  user_id: 'apikey-user-1',
  tenant: 'tenant-9f',
  first_name: 'API',
  last_name: 'Key',
  email: 'apikey@example.test',
  is_inactive: false,
} as unknown as IUserWithRoles;

beforeEach(() => {
  db.runWithTenant.mockReset();
  db.runWithTenant.mockImplementation(
    (_tenant: string, action: () => unknown) => action()
  );
  session.getSessionWithRevocationCheck.mockReset();
  session.getSessionWithRevocationCheck.mockResolvedValue({
    user: { id: 'session-user', tenant: 'tenant-other' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runWithApiKeyUser -> withAuth', () => {
  it('resolves the API-key user for a downstream withAuth-wrapped action', async () => {
    const action = withAuth(async (user) => user);

    const resolved = await runWithApiKeyUser(apiKeyUser, () => action());

    expect(resolved).toMatchObject({
      user_id: apiKeyUser.user_id,
      tenant: apiKeyUser.tenant,
      first_name: apiKeyUser.first_name,
      last_name: apiKeyUser.last_name,
      email: apiKeyUser.email,
      is_inactive: false,
      roles: [],
    });
    expect(resolved).not.toHaveProperty('hashed_password');
    expect(resolved).not.toHaveProperty('two_factor_secret');
    expect(resolved).not.toHaveProperty('unexpected_credential');
    // The API-key identity takes precedence, so the ambient session is never
    // consulted (which is what previously threw a generic AuthenticationError).
    expect(session.getSessionWithRevocationCheck).not.toHaveBeenCalled();
  });

  it('provides the API-key tenant as the action tenant context', async () => {
    const action = withAuth(async (_user, ctx) => ctx.tenant);

    const resolvedTenant = await runWithApiKeyUser(apiKeyUser, () => action());

    expect(resolvedTenant).toBe('tenant-9f');
  });

  it('sanitizes API-key identity through the same safe current-user boundary', async () => {
    const credentialBearingUser = {
      ...apiKeyUser,
      phone_extension: '204',
      hashed_password: 'api-key-password-hash',
      two_factor_secret: 'api-key-totp-secret',
      unexpected_credential: 'must-not-escape',
    } as unknown as IUserWithRoles;

    const resolved = await runWithApiKeyUser(credentialBearingUser, () => getCurrentUser());
    const serialized = JSON.stringify(resolved);

    expect(resolved).toMatchObject({
      user_id: 'apikey-user-1',
      tenant: 'tenant-9f',
      email: 'apikey@example.test',
      phone_extension: '204',
      roles: [],
    });
    expect(resolved).not.toHaveProperty('hashed_password');
    expect(resolved).not.toHaveProperty('two_factor_secret');
    expect(resolved).not.toHaveProperty('unexpected_credential');
    expect(serialized).not.toContain('api-key-password-hash');
    expect(serialized).not.toContain('api-key-totp-secret');
    expect(serialized).not.toContain('must-not-escape');
  });
});
