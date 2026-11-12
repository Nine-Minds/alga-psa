import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const requestHeaders = vi.hoisted(() => ({ current: new Headers({ 'x-request-id': 'req-safe-1' }) }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => requestHeaders.current),
}));

vi.mock('../nextauth/edge-auth', () => ({
  auth: vi.fn(),
}));

vi.mock('../nextauth/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {
    isRevokedOrIdentityMismatch: vi.fn(),
    getRejectionReason: vi.fn(),
  },
}));

const loadTenantAuthPolicy = vi.hoisted(() => vi.fn());
vi.mock('./authPolicyStore', () => ({
  loadTenantAuthPolicy,
  recordLoginRefusal: vi.fn(),
}));

import { getSession, getSessionWithRevocationCheck } from './getSession';
import { auth as edgeAuth } from '../nextauth/edge-auth';
import { auth as fullAuth } from '../nextauth/auth';
import { UserSession } from '@alga-psa/db/models/UserSession';
import logger from '@alga-psa/core/logger';

const trackedSession = {
  user: {
    id: 'user-1',
    tenant: 'tenant-1',
    email: 'user@example.test',
    user_type: 'internal',
  },
  session_id: 'session-1',
} as any;

const envSnapshot = { ...process.env };

beforeEach(() => {
  vi.mocked(edgeAuth).mockReset();
  vi.mocked(fullAuth).mockReset();
  vi.mocked(UserSession.isRevokedOrIdentityMismatch).mockReset();
  vi.mocked(UserSession.getRejectionReason).mockReset();
  vi.mocked(logger.warn).mockReset();
  loadTenantAuthPolicy.mockReset();
  loadTenantAuthPolicy.mockResolvedValue({
    requireSsoForInternalUsers: false,
    require2faForInternalUsers: false,
    require2faForClientUsers: false,
    allowKnownDevice2faSkip: false,
    passwordBreakGlassUserIds: [],
    passwordAuthDisabledAt: null,
  });
  vi.mocked(logger.error).mockReset();
  requestHeaders.current = new Headers({ 'x-request-id': 'req-safe-1' });
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

describe('getSession', () => {
  it('returns the edge-decoded session once the sessions table confirms it is live', async () => {
    vi.mocked(edgeAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.getRejectionReason).mockResolvedValue(null);

    const session = await getSession();

    expect(session).toBe(trackedSession);
    expect(UserSession.getRejectionReason).toHaveBeenCalledWith(
      'tenant-1',
      'session-1',
      { userId: 'user-1', userType: 'internal' }
    );
  });

  it('rejects a revoked session even though the edge decoder accepts its JWT', async () => {
    vi.mocked(edgeAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.getRejectionReason).mockResolvedValue('revoked');

    await expect(getSession()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('[auth] session_rejected', {
      reason: 'durable_session_revoked', requestId: 'req-safe-1',
    });
  });

  it('rejects a session with no tracked session identifier without querying the database', async () => {
    vi.mocked(edgeAuth).mockResolvedValue({
      user: { id: 'user-1', tenant: 'tenant-1' },
    } as any);

    await expect(getSession()).resolves.toBeNull();
    expect(UserSession.isRevokedOrIdentityMismatch).not.toHaveBeenCalled();
  });

  it('rejects a session whose tenant claim is missing', async () => {
    vi.mocked(edgeAuth).mockResolvedValue({
      user: { id: 'user-1' },
      session_id: 'session-1',
    } as any);

    await expect(getSession()).resolves.toBeNull();
    expect(UserSession.isRevokedOrIdentityMismatch).not.toHaveBeenCalled();
  });

  it('fails closed when the revocation lookup throws', async () => {
    vi.mocked(edgeAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.getRejectionReason).mockRejectedValue(new Error('connection refused'));

    await expect(getSession()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('[auth] session_rejected', {
      reason: 'durable_session_lookup_unavailable', requestId: 'req-safe-1',
    });
  });

  it('logs decode failure with correlation and a reason code without logging the rejected payload', async () => {
    requestHeaders.current = new Headers({
      'x-correlation-id': 'corr-safe-2',
      cookie: 'authjs.session-token=never-log-this-cookie',
    });
    vi.mocked(edgeAuth).mockRejectedValue(new Error('never-log-this-decode-payload'));
    vi.mocked(fullAuth).mockRejectedValue(new Error('never-log-this-fallback-payload'));

    await expect(getSession()).resolves.toBeNull();

    expect(logger.warn).toHaveBeenCalledWith('[auth] session_rejected', {
      reason: 'edge_session_decode_failed', requestId: 'corr-safe-2',
    });
    expect(logger.warn).toHaveBeenCalledWith('[auth] session_rejected', {
      reason: 'full_session_decode_failed', requestId: 'corr-safe-2',
    });
    const serializedLogs = JSON.stringify([
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.error).mock.calls,
    ]);
    expect(serializedLogs).not.toContain('never-log-this');
  });

  it('attributes an empty edge result followed by a full-auth throw only to the full decoder', async () => {
    vi.mocked(edgeAuth).mockResolvedValue(null);
    vi.mocked(fullAuth).mockRejectedValue(new Error('full decoder failed'));

    await expect(getSession()).resolves.toBeNull();

    expect(logger.warn).toHaveBeenCalledWith('[auth] session_rejected', {
      reason: 'full_session_decode_failed', requestId: 'req-safe-1',
    });
    expect(logger.warn).not.toHaveBeenCalledWith('[auth] session_rejected', {
      reason: 'edge_session_decode_failed', requestId: 'req-safe-1',
    });
  });

  it('still enforces revocation on the full-auth fallback path', async () => {
    vi.mocked(edgeAuth).mockResolvedValue(null);
    vi.mocked(fullAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.getRejectionReason).mockResolvedValue('revoked');

    await expect(getSession()).resolves.toBeNull();
    expect(fullAuth).toHaveBeenCalled();
  });
});

describe('getSessionWithRevocationCheck', () => {
  it('returns a live session decoded by full auth', async () => {
    vi.mocked(fullAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.getRejectionReason).mockResolvedValue(null);

    await expect(getSessionWithRevocationCheck()).resolves.toBe(trackedSession);
  });

  it('rejects a revoked session reached through the dev-only edge fallback', async () => {
    process.env.NODE_ENV = 'development';
    vi.mocked(fullAuth).mockResolvedValue(null);
    vi.mocked(edgeAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.getRejectionReason).mockResolvedValue('revoked');

    await expect(getSessionWithRevocationCheck()).resolves.toBeNull();
  });
});

describe('getSession login policy (SSO required)', () => {
  const cutoff = Date.parse('2026-01-01T00:00:00Z');
  const ssoPolicy = (breakGlass: string[] = []) => ({
    requireSsoForInternalUsers: true,
    require2faForInternalUsers: false,
    require2faForClientUsers: false,
    allowKnownDevice2faSkip: false,
    passwordBreakGlassUserIds: breakGlass,
    passwordAuthDisabledAt: new Date(cutoff).toISOString(),
  });
  const sessionWith = (overrides: Record<string, unknown>, user: Record<string, unknown> = {}) => ({
    ...trackedSession,
    user: { ...trackedSession.user, ...user },
    login_method: 'credentials',
    auth_issued_at: cutoff - 1000,
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(UserSession.getRejectionReason).mockResolvedValue(null);
  });

  it('rejects a pre-cutoff internal password session', async () => {
    loadTenantAuthPolicy.mockResolvedValue(ssoPolicy());
    vi.mocked(edgeAuth).mockResolvedValue(sessionWith({}));

    expect(await getSession()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('[auth] session_rejected', expect.objectContaining({ reason: 'login_policy_sso_required' }));
  });

  it('rejects a password session with no auth_issued_at claim', async () => {
    loadTenantAuthPolicy.mockResolvedValue(ssoPolicy());
    vi.mocked(edgeAuth).mockResolvedValue(sessionWith({ auth_issued_at: undefined }));

    expect(await getSession()).toBeNull();
  });

  it('accepts break-glass, SSO, post-cutoff and client sessions', async () => {
    loadTenantAuthPolicy.mockResolvedValue(ssoPolicy(['user-1']));
    const breakGlass = sessionWith({});
    vi.mocked(edgeAuth).mockResolvedValue(breakGlass);
    expect(await getSession()).toBe(breakGlass);

    loadTenantAuthPolicy.mockResolvedValue(ssoPolicy());
    const sso = sessionWith({ login_method: 'google' });
    vi.mocked(edgeAuth).mockResolvedValue(sso);
    expect(await getSession()).toBe(sso);

    const fresh = sessionWith({ auth_issued_at: cutoff + 1000 });
    vi.mocked(edgeAuth).mockResolvedValue(fresh);
    expect(await getSession()).toBe(fresh);

    const client = sessionWith({}, { user_type: 'client' });
    vi.mocked(edgeAuth).mockResolvedValue(client);
    expect(await getSession()).toBe(client);
  });

  it('fails open when the policy cannot be read', async () => {
    loadTenantAuthPolicy.mockRejectedValue(new Error('db down'));
    const session = sessionWith({});
    vi.mocked(edgeAuth).mockResolvedValue(session);

    expect(await getSession()).toBe(session);
  });
});
