import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
  },
}));

import { getSession, getSessionWithRevocationCheck } from './getSession';
import { auth as edgeAuth } from '../nextauth/edge-auth';
import { auth as fullAuth } from '../nextauth/auth';
import { UserSession } from '@alga-psa/db/models/UserSession';

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
    vi.mocked(UserSession.isRevokedOrIdentityMismatch).mockResolvedValue(false);

    const session = await getSession();

    expect(session).toBe(trackedSession);
    expect(UserSession.isRevokedOrIdentityMismatch).toHaveBeenCalledWith(
      'tenant-1',
      'session-1',
      { userId: 'user-1', userType: 'internal' }
    );
  });

  it('rejects a revoked session even though the edge decoder accepts its JWT', async () => {
    vi.mocked(edgeAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.isRevokedOrIdentityMismatch).mockResolvedValue(true);

    await expect(getSession()).resolves.toBeNull();
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
    vi.mocked(UserSession.isRevokedOrIdentityMismatch).mockRejectedValue(new Error('connection refused'));

    await expect(getSession()).resolves.toBeNull();
  });

  it('still enforces revocation on the full-auth fallback path', async () => {
    vi.mocked(edgeAuth).mockResolvedValue(null);
    vi.mocked(fullAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.isRevokedOrIdentityMismatch).mockResolvedValue(true);

    await expect(getSession()).resolves.toBeNull();
    expect(fullAuth).toHaveBeenCalled();
  });
});

describe('getSessionWithRevocationCheck', () => {
  it('returns a live session decoded by full auth', async () => {
    vi.mocked(fullAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.isRevokedOrIdentityMismatch).mockResolvedValue(false);

    await expect(getSessionWithRevocationCheck()).resolves.toBe(trackedSession);
  });

  it('rejects a revoked session reached through the dev-only edge fallback', async () => {
    process.env.NODE_ENV = 'development';
    vi.mocked(fullAuth).mockResolvedValue(null);
    vi.mocked(edgeAuth).mockResolvedValue(trackedSession);
    vi.mocked(UserSession.isRevokedOrIdentityMismatch).mockResolvedValue(true);

    await expect(getSessionWithRevocationCheck()).resolves.toBeNull();
  });
});
