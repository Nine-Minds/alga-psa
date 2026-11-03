import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: lifecycleLogger }));

const updateMock = vi.fn(async () => 1);
const returningMock = vi.fn(async () => [{ session_id: 'created-session-secret' }]);
const firstMock = vi.fn(async () => ({ revoked_at: null }));
const builder = {
  where: vi.fn(() => builder),
  whereNull: vi.fn(() => builder),
  select: vi.fn(() => builder),
  leftJoin: vi.fn(() => builder),
  first: firstMock,
  update: updateMock,
  insert: vi.fn(() => builder),
  returning: returningMock,
};

const knexFn = Object.assign(
  vi.fn((_table: string) => builder),
  { fn: { now: () => '__now__' } },
);

const getConnectionMock = vi.fn(async () => knexFn);

vi.mock('../lib/tenant', () => ({ getConnection: (...args: unknown[]) => getConnectionMock(...(args as [])) }));

const { UserSession, logSessionLifecycle, sessionCorrelationId } = await import('./UserSession');

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

  it('returns distinct safe durable-session rejection reasons', async () => {
    const identity = { userId: 'user-1', userType: 'internal' as const };
    firstMock.mockResolvedValueOnce(undefined as any);
    await expect(UserSession.getRejectionReason('tenant-1', 'missing', identity)).resolves.toBe('missing');
    firstMock.mockResolvedValueOnce({ revoked_at: new Date(), session_user_id: 'user-1', actual_user_type: 'internal' });
    await expect(UserSession.getRejectionReason('tenant-1', 'revoked', identity)).resolves.toBe('revoked');
    firstMock.mockResolvedValueOnce({ revoked_at: null, session_user_id: 'user-1', actual_user_type: null });
    await expect(UserSession.getRejectionReason('tenant-1', 'missing-user', identity)).resolves.toBe('user_missing');
    firstMock.mockResolvedValueOnce({ revoked_at: null, session_user_id: 'other-user', actual_user_type: 'internal' });
    await expect(UserSession.getRejectionReason('tenant-1', 'mismatch', identity)).resolves.toBe('identity_mismatch');
    firstMock.mockResolvedValueOnce({ revoked_at: null, session_user_id: 'user-1', actual_user_type: 'internal' });
    await expect(UserSession.getRejectionReason('tenant-1', 'live', identity)).resolves.toBeNull();
  });
});

describe('session lifecycle diagnostics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('correlates lifecycle events without logging the session id or credential data', () => {
    const sessionId = 'durable-session-id-secret';
    logSessionLifecycle('created', sessionId);
    logSessionLifecycle('signed_out', sessionId);
    logSessionLifecycle('rejected', sessionId, 'max_sessions');
    logSessionLifecycle('revoked', sessionId, 'max_sessions');

    const records = [
      ...lifecycleLogger.info.mock.calls,
      ...lifecycleLogger.warn.mock.calls,
    ].map(([message, meta]) => ({ message, meta }));
    expect(records).toHaveLength(4);
    expect(records.map(({ meta }) => meta.sessionCorrelationId)).toEqual([
      sessionCorrelationId(sessionId),
      sessionCorrelationId(sessionId),
      sessionCorrelationId(sessionId),
      sessionCorrelationId(sessionId),
    ]);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(sessionId);
    expect(serialized).not.toContain('cookie');
    expect(serialized).not.toContain('jwt');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('totp');
    expect(serialized).not.toContain('recovery');
  });

  it('records the same safe correlation format when durable session creation succeeds', async () => {
    const sessionId = 'created-session-secret';
    returningMock.mockResolvedValueOnce([{ session_id: sessionId }]);

    await expect(UserSession.create({
      tenant: 'tenant-secret',
      user_id: 'user-secret',
      ip_address: '192.0.2.1',
      user_agent: 'sensitive-user-agent',
      device_fingerprint: 'sensitive-fingerprint',
      device_name: 'sensitive-device',
      device_type: 'desktop',
      expires_at: new Date('2030-01-01T00:00:00.000Z'),
      login_method: 'credentials',
    })).resolves.toBe(sessionId);

    expect(lifecycleLogger.info).toHaveBeenCalledWith('[auth] session_lifecycle', {
      event: 'created',
      sessionCorrelationId: sessionCorrelationId(sessionId),
    });
    const serialized = JSON.stringify(lifecycleLogger.info.mock.calls);
    expect(serialized).not.toContain(sessionId);
    expect(serialized).not.toContain('tenant-secret');
    expect(serialized).not.toContain('user-secret');
    expect(serialized).not.toContain('sensitive-');
  });

  it('bounds arbitrary diagnostic reasons to a safe category', () => {
    logSessionLifecycle('revoked', 'session-id', 'password=secret-cookie-jwt');
    expect(lifecycleLogger.info).toHaveBeenCalledWith('[auth] session_lifecycle', {
      event: 'revoked',
      sessionCorrelationId: sessionCorrelationId('session-id'),
      reason: 'other',
    });
    expect(JSON.stringify(lifecycleLogger.info.mock.calls)).not.toContain('secret');
  });

  it('correlates a database rejection with its bounded durable revocation reason', async () => {
    const sessionId = 'durable-session-id-secret';
    firstMock.mockResolvedValueOnce({
      revoked_at: new Date(),
      revoked_reason: 'max_sessions',
      session_user_id: 'user-1',
      actual_user_type: 'internal',
    });

    await expect(UserSession.getRejectionReason('tenant-1', sessionId, {
      userId: 'user-1', userType: 'internal',
    })).resolves.toBe('revoked');

    expect(lifecycleLogger.warn).toHaveBeenCalledWith('[auth] session_lifecycle', {
      event: 'rejected',
      sessionCorrelationId: sessionCorrelationId(sessionId),
      reason: 'max_sessions',
    });
    expect(JSON.stringify(lifecycleLogger.warn.mock.calls)).not.toContain(sessionId);
  });

  it('records a successful direct revocation with the same correlation identifier', async () => {
    const sessionId = 'durable-session-id-secret';
    updateMock.mockResolvedValueOnce(1);

    await UserSession.revokeSession('tenant-1', sessionId, 'user_logout');

    expect(lifecycleLogger.info).toHaveBeenCalledWith('[auth] session_lifecycle', {
      event: 'revoked',
      sessionCorrelationId: sessionCorrelationId(sessionId),
      reason: 'user_logout',
    });
    expect(JSON.stringify(lifecycleLogger.info.mock.calls)).not.toContain(sessionId);
  });
});
