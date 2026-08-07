import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';

const mocks = vi.hoisted(() => ({
  edgeAuth: vi.fn(),
  fullAuth: vi.fn(),
  getUserWithRoles: vi.fn(),
  isRevokedOrIdentityMismatch: vi.fn(),
  runWithTenant: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../nextauth/edge-auth', () => ({
  auth: mocks.edgeAuth,
}));

vi.mock('../nextauth/auth', () => ({
  auth: mocks.fullAuth,
}));

vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {
    isRevokedOrIdentityMismatch: mocks.isRevokedOrIdentityMismatch,
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  getUserWithRoles: mocks.getUserWithRoles,
  getUserWithRolesByEmail: vi.fn(),
  runWithTenant: mocks.runWithTenant,
}));

import { AuthenticationError, withAuth } from './withAuth';

const trackedSession = {
  user: {
    id: 'user-1',
    tenant: 'tenant-1',
    email: 'user@example.test',
    user_type: 'internal',
  },
  session_id: 'session-1',
} as unknown as Session;

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.runWithTenant.mockImplementation(
    (_tenant: string, action: () => Promise<unknown>) => action()
  );
});

describe('withAuth durable session enforcement', () => {
  it('rejects a revoked JWT before the wrapped action runs', async () => {
    mocks.fullAuth.mockResolvedValue(trackedSession);
    mocks.isRevokedOrIdentityMismatch.mockResolvedValue(true);
    const action = vi.fn();
    const wrapped = withAuth(action);

    await expect(wrapped()).rejects.toBeInstanceOf(AuthenticationError);

    expect(mocks.fullAuth).toHaveBeenCalledOnce();
    expect(mocks.edgeAuth).not.toHaveBeenCalled();
    expect(mocks.isRevokedOrIdentityMismatch).toHaveBeenCalledWith(
      'tenant-1',
      'session-1',
      { userId: 'user-1', userType: 'internal' }
    );
    expect(mocks.getUserWithRoles).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('rejects a JWT with no session identifier before the wrapped action runs', async () => {
    mocks.fullAuth.mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
        email: 'user@example.test',
      },
    });
    const action = vi.fn();
    const wrapped = withAuth(action);

    await expect(wrapped()).rejects.toBeInstanceOf(AuthenticationError);

    expect(mocks.fullAuth).toHaveBeenCalledOnce();
    expect(mocks.edgeAuth).not.toHaveBeenCalled();
    expect(mocks.isRevokedOrIdentityMismatch).not.toHaveBeenCalled();
    expect(mocks.getUserWithRoles).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('authorizes a live tracked session through the full-auth-first path', async () => {
    mocks.fullAuth.mockResolvedValue(trackedSession);
    mocks.isRevokedOrIdentityMismatch.mockResolvedValue(false);
    mocks.getUserWithRoles.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
      roles: [],
      is_inactive: false,
    });
    const action = vi.fn(async (_user, { tenant }) => tenant);
    const wrapped = withAuth(action);

    await expect(wrapped()).resolves.toBe('tenant-1');

    expect(mocks.fullAuth).toHaveBeenCalledOnce();
    expect(mocks.edgeAuth).not.toHaveBeenCalled();
    expect(mocks.isRevokedOrIdentityMismatch).toHaveBeenCalledWith(
      'tenant-1',
      'session-1',
      { userId: 'user-1', userType: 'internal' }
    );
    expect(mocks.runWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(action).toHaveBeenCalledOnce();
  });
});
