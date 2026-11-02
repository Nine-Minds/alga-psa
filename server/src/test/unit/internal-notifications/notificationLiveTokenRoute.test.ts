import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), getApiKeyUserOverride: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  getSession: mocks.getSession,
  getApiKeyUserOverride: mocks.getApiKeyUserOverride,
}));
vi.mock('@/lib/hocuspocusJwt', () => ({ getHocuspocusJwtSecret: async () => 'route-secret' }));

import { GET } from '../../../app/api/notifications/live-token/route';

const tenant = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const liveSession = (overrides: Record<string, unknown> = {}) => ({
  session_id: sessionId,
  expires: new Date(Date.now() + 3600_000).toISOString(),
  user: { id: user, tenant, user_type: 'internal' },
  ...overrides,
});

describe('GET /api/notifications/live-token', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue(liveSession());
    mocks.getApiKeyUserOverride.mockReset().mockReturnValue(undefined);
  });

  it('mints a no-store token for the live session, clamped to its expiry', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
    const body = await response.json();
    expect(body).toMatchObject({ tenant, userId: user });
    expect(body.expiresInMs).toBeGreaterThan(290_000);
    expect(body.expiresInMs).toBeLessThanOrEqual(300_000);
    expect(jwt.verify(body.token, 'route-secret', { audience: 'notification-signals' })).toMatchObject({ tenantId: tenant, userId: user, sessionId });

    mocks.getSession.mockResolvedValue(liveSession({ expires: new Date(Date.now() + 60_000).toISOString() }));
    const clamped = await (await GET()).json();
    expect(clamped.expiresAt - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it('401s without a live session, for an API-key principal, for a non-interactive user type and for an ended session', async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    mocks.getSession.mockResolvedValue(liveSession({ user: { id: user, tenant, user_type: 'service' } }));
    expect((await GET()).status).toBe(401);
    mocks.getSession.mockResolvedValue(liveSession({ expires: new Date(Date.now() - 1000).toISOString() }));
    expect((await GET()).status).toBe(401);
    mocks.getSession.mockResolvedValue(liveSession());
    mocks.getApiKeyUserOverride.mockReturnValue({ user_id: 'machine' });
    expect((await GET()).status).toBe(401);
  });

  it('503s when the session cannot be resolved', async () => {
    mocks.getSession.mockRejectedValue(new Error('boom'));
    expect((await GET()).status).toBe(503);
  });
});
