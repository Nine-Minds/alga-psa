import { beforeEach, describe, expect, it, vi } from 'vitest';

// T010 (getSession half): a session whose type claim is 'service' (or anything
// non-interactive) is rejected before the sessions table is even consulted.
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('../nextauth/edge-auth', () => ({ auth: vi.fn() }));
vi.mock('../nextauth/auth', () => ({ auth: vi.fn() }));
vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: { isRevokedOrIdentityMismatch: vi.fn(), getRejectionReason: vi.fn() },
}));

import { getSession, getSessionWithRevocationCheck } from './getSession';
import { auth as edgeAuth } from '../nextauth/edge-auth';
import { auth as fullAuth } from '../nextauth/auth';
import { UserSession } from '@alga-psa/db/models/UserSession';

const sessionOf = (userType: unknown) =>
  ({ user: { id: 'u1', tenant: 't1', email: 'x@example.test', user_type: userType }, session_id: 's1' }) as any;

beforeEach(() => {
  vi.mocked(edgeAuth).mockReset();
  vi.mocked(fullAuth).mockReset();
  vi.mocked(UserSession.getRejectionReason).mockReset().mockResolvedValue(null);
});

describe('T010: requireLiveSession rejects non-interactive stored types', () => {
  it.each(['service', 'robot', '', undefined, null])('getSession rejects user_type %j even if the sessions row looks live', async (type) => {
    vi.mocked(edgeAuth).mockResolvedValue(sessionOf(type));
    await expect(getSession()).resolves.toBeNull();
    expect(UserSession.getRejectionReason).not.toHaveBeenCalled();
  });

  it('getSessionWithRevocationCheck rejects a service session', async () => {
    vi.mocked(fullAuth).mockResolvedValue(sessionOf('service'));
    await expect(getSessionWithRevocationCheck()).resolves.toBeNull();
    expect(UserSession.getRejectionReason).not.toHaveBeenCalled();
  });

  it.each(['internal', 'client'])('still accepts a live %s session', async (type) => {
    const session = sessionOf(type);
    vi.mocked(edgeAuth).mockResolvedValue(session);
    await expect(getSession()).resolves.toBe(session);
    expect(UserSession.getRejectionReason).toHaveBeenCalledWith('t1', 's1', { userId: 'u1', userType: type });
  });
});
