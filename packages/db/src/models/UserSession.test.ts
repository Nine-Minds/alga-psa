import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateMock = vi.fn(async () => 1);
const firstMock = vi.fn(async () => ({ revoked_at: null }));
const builder = {
  where: vi.fn(() => builder),
  whereNull: vi.fn(() => builder),
  select: vi.fn(() => builder),
  leftJoin: vi.fn(() => builder),
  first: firstMock,
  update: updateMock,
};

const knexFn = Object.assign(
  vi.fn((_table: string) => builder),
  { fn: { now: () => '__now__' } },
);

const getConnectionMock = vi.fn(async () => knexFn);

vi.mock('../lib/tenant', () => ({ getConnection: (...args: unknown[]) => getConnectionMock(...(args as [])) }));

const { UserSession } = await import('./UserSession');

describe('UserSession.extendExpiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates expires_at for the matching, non-revoked session row', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');

    await UserSession.extendExpiry('tenant-1', 'sess-1', expiresAt);

    expect(getConnectionMock).toHaveBeenCalledWith('tenant-1');
    expect(knexFn).toHaveBeenCalledWith('sessions');
    expect(builder.where).toHaveBeenCalledWith('sessions.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenCalledWith({ session_id: 'sess-1' });
    // Guard: never resurrect a revoked session.
    expect(builder.whereNull).toHaveBeenCalledWith('revoked_at');
    expect(updateMock).toHaveBeenCalledWith({ expires_at: expiresAt, updated_at: '__now__' });
  });

  it('reads durable revocation state on every request', async () => {
    firstMock.mockResolvedValue({ revoked_at: null });

    await expect(UserSession.isRevoked('tenant-1', 'scim-session-open')).resolves.toBe(false);
    firstMock.mockResolvedValue({ revoked_at: new Date() });
    await expect(UserSession.isRevoked('tenant-1', 'scim-session-open')).resolves.toBe(true);

    expect(firstMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a revoked answer', async () => {
    firstMock.mockResolvedValue({ revoked_at: new Date() });

    await expect(UserSession.isRevoked('tenant-1', 'scim-session-revoked')).resolves.toBe(true);
    await expect(UserSession.isRevoked('tenant-1', 'scim-session-revoked')).resolves.toBe(true);

    expect(firstMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a live session when its JWT user type does not match the database user', async () => {
    firstMock.mockResolvedValue({
      revoked_at: null,
      session_user_id: 'client-user-1',
      actual_user_type: 'client',
    });

    await expect(UserSession.isRevokedOrIdentityMismatch(
      'tenant-1',
      'client-session',
      { userId: 'client-user-1', userType: 'internal' }
    )).resolves.toBe(true);

    await expect(UserSession.isRevokedOrIdentityMismatch(
      'tenant-1',
      'client-session',
      { userId: 'client-user-1', userType: 'client' }
    )).resolves.toBe(false);
  });
});
