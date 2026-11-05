import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: lifecycleLogger }));

const returningMock = vi.fn(async () => [{ session_id: 'created-session-secret' }]);
const updateResult = {
  returning: returningMock,
  then: (resolve: (value: number) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(1).then(resolve, reject),
};
const updateMock = vi.fn(() => updateResult);
let activeSessionRows: Array<{ session_id: string }> = [];
const forUpdateMock = vi.fn(async () => activeSessionRows);
const firstMock = vi.fn(async () => ({ revoked_at: null }));
const builder = {
  where: vi.fn(() => builder),
  whereNot: vi.fn(() => builder),
  whereIn: vi.fn(() => builder),
  whereNull: vi.fn(() => builder),
  select: vi.fn(() => builder),
  orderBy: vi.fn(() => builder),
  forUpdate: forUpdateMock,
  leftJoin: vi.fn(() => builder),
  first: firstMock,
  update: updateMock,
  insert: vi.fn(() => builder),
  returning: returningMock,
};

const knexFn = Object.assign(
  vi.fn((_table: string) => builder),
  {
    fn: { now: () => '__now__' },
    transaction: vi.fn(async (callback: (trx: any) => Promise<unknown>) => callback(knexFn)),
  },
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
  beforeEach(() => {
    vi.clearAllMocks();
    activeSessionRows = [];
  });

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

  it.each(['__proto__', 'constructor', 'toString'])('bounds inherited property name %s to a safe category', (reason) => {
    logSessionLifecycle('rejected', 'session-id', reason);

    expect(lifecycleLogger.warn).toHaveBeenCalledWith('[auth] session_lifecycle', {
      event: 'rejected',
      sessionCorrelationId: sessionCorrelationId('session-id'),
      reason: 'other',
    });
  });

  it.each([
    ['durable_session_missing', 'missing'],
    ['durable_session_revoked', 'revoked'],
    ['durable_session_user_missing', 'user_missing'],
    ['durable_session_identity_mismatch', 'identity_mismatch'],
    ['durable_session_lookup_unavailable', 'lookup_unavailable'],
    ['missing_identity_claims', 'missing_identity_claims'],
  ])('normalizes the bounded rejection category %s', (input, expected) => {
    logSessionLifecycle('rejected', 'session-id', input);
    expect(lifecycleLogger.warn).toHaveBeenCalledWith('[auth] session_lifecycle', {
      event: 'rejected',
      sessionCorrelationId: sessionCorrelationId('session-id'),
      reason: expected,
    });
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
    updateMock.mockImplementationOnce(() => updateResult);

    await UserSession.revokeSession('tenant-1', sessionId, 'user_logout');

    expect(lifecycleLogger.info).toHaveBeenCalledWith('[auth] session_lifecycle', {
      event: 'revoked',
      sessionCorrelationId: sessionCorrelationId(sessionId),
      reason: 'user_logout',
    });
    expect(JSON.stringify(lifecycleLogger.info.mock.calls)).not.toContain(sessionId);
  });

  it('returns the bulk revoke count and correlates each successfully returned row', async () => {
    const rows = [{ session_id: 'bulk-session-a' }, { session_id: 'bulk-session-b' }];
    returningMock.mockResolvedValueOnce(rows);

    await expect(UserSession.revokeAllExcept('tenant-1', 'user-1', 'current-session'))
      .resolves.toBe(2);

    expect(lifecycleLogger.info).toHaveBeenCalledTimes(2);
    for (const row of rows) {
      expect(lifecycleLogger.info).toHaveBeenCalledWith('[auth] session_lifecycle', {
        event: 'revoked',
        sessionCorrelationId: sessionCorrelationId(row.session_id),
        reason: 'user_logout_all',
      });
    }
    expect(JSON.stringify(lifecycleLogger.info.mock.calls)).not.toContain('bulk-session');
  });

  it('returns the admin bulk revoke count and correlates successful rows', async () => {
    const rows = [{ session_id: 'admin-session-a' }, { session_id: 'admin-session-b' }];
    returningMock.mockResolvedValueOnce(rows);

    await expect(UserSession.revokeAllForUser('tenant-1', 'user-1')).resolves.toBe(2);

    expect(lifecycleLogger.info).toHaveBeenCalledTimes(2);
    for (const row of rows) {
      expect(lifecycleLogger.info).toHaveBeenCalledWith('[auth] session_lifecycle', {
        event: 'revoked',
        sessionCorrelationId: sessionCorrelationId(row.session_id),
        reason: 'admin_revoke',
      });
    }
    expect(JSON.stringify(lifecycleLogger.info.mock.calls)).not.toContain('admin-session');
  });

  it('correlates only rows returned by a successful max-session update', async () => {
    activeSessionRows = Array.from({ length: 6 }, (_, index) => ({ session_id: `max-session-${index}` }));
    returningMock.mockResolvedValueOnce([
      { session_id: 'max-session-0' },
      { session_id: 'max-session-1' },
    ]);

    await UserSession.enforceMaxSessions('tenant-1', 'user-1', 5);

    expect(knexFn.transaction).toHaveBeenCalledOnce();
    expect(lifecycleLogger.info).toHaveBeenCalledTimes(2);
    for (const sessionId of ['max-session-0', 'max-session-1']) {
      expect(lifecycleLogger.info).toHaveBeenCalledWith('[auth] session_lifecycle', {
        event: 'revoked',
        sessionCorrelationId: sessionCorrelationId(sessionId),
        reason: 'max_sessions',
      });
    }
  });

  it.each([
    ['cleanupExpired', 'expired'],
    ['cleanupInactive', 'inactivity'],
  ] as const)('%s reports only successfully revoked rows', async (method, reason) => {
    returningMock.mockResolvedValueOnce([{ session_id: 'cleanup-session' }]);

    await expect(UserSession[method]('tenant-1')).resolves.toBe(1);
    expect(lifecycleLogger.info).toHaveBeenCalledExactlyOnceWith('[auth] session_lifecycle', {
      event: 'revoked',
      sessionCorrelationId: sessionCorrelationId('cleanup-session'),
      reason,
    });

    lifecycleLogger.info.mockClear();
    returningMock.mockResolvedValueOnce([]);
    await expect(UserSession[method]('tenant-1')).resolves.toBe(0);
    expect(lifecycleLogger.info).not.toHaveBeenCalled();
  });

  it('does not report max-session revocations when the transaction fails to commit', async () => {
    activeSessionRows = [{ session_id: 'rolled-back-session' }];
    returningMock.mockResolvedValueOnce(activeSessionRows);
    knexFn.transaction.mockImplementationOnce(async (callback) => {
      await callback(knexFn);
      throw new Error('transaction commit failed');
    });

    await expect(UserSession.enforceMaxSessions('tenant-1', 'user-1', 1))
      .rejects.toThrow('transaction commit failed');
    expect(lifecycleLogger.info).not.toHaveBeenCalled();
  });
});
