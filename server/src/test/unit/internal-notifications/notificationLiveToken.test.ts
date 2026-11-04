import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  issueNotificationLiveToken,
  NOTIFICATION_LIVE_TOKEN_TTL_SECONDS,
} from '../../../lib/notifications/notificationLiveToken';
import { validateNotificationSignalRoom } from '../../../../../hocuspocus/tenantValidation.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const secret = 'notification-live-token-secret';
const NOW = 1_800_000_000_000;
const actor = { tenant, userId: user, sessionId, userType: 'internal' as const };
const farFuture = NOW + 24 * 3600 * 1000;
const room = `notification-signals:${tenant}:${user}`;

function issue(options: Partial<Parameters<typeof issueNotificationLiveToken>[1]> = {}, who = actor) {
  return issueNotificationLiveToken(who, { secret, now: NOW, sessionExpiresAt: farFuture, ...options });
}

describe('issueNotificationLiveToken', () => {
  it('signs an HS256 token with audience/scope notification-signals and a 300s lifetime', () => {
    const result = issue()!;
    const claims = jwt.decode(result.token, { complete: true })!;
    expect(claims.header.alg).toBe('HS256');
    expect(claims.payload).toMatchObject({
      aud: 'notification-signals', scope: 'notification-signals', tenantId: tenant, userId: user, sessionId,
      iat: NOW / 1000, exp: NOW / 1000 + 300,
    });
    expect((claims.payload as any).jti).toEqual(expect.any(String));
    expect(NOTIFICATION_LIVE_TOKEN_TTL_SECONDS).toBe(300);
    expect(result).toMatchObject({ tenant, userId: user, expiresAt: (NOW / 1000 + 300) * 1000 });
  });

  it('clamps exp to the session expiry', () => {
    const result = issue({ sessionExpiresAt: NOW + 90_000 })!;
    expect(result.expiresAt).toBe(NOW + 90_000);
    expect((jwt.decode(result.token) as any).exp).toBe(NOW / 1000 + 90);
  });

  it('never exceeds 300s even if a longer ttl is requested', () => {
    expect(issue({ ttlSeconds: 3600 })!.expiresAt).toBe(NOW + 300_000);
    expect(issue({ ttlSeconds: 30 })!.expiresAt).toBe(NOW + 30_000);
  });

  it('refuses an expired session, bad ids, bad user types and a missing secret', () => {
    expect(issue({ sessionExpiresAt: NOW })).toBeNull();
    expect(issue({ sessionExpiresAt: NOW - 1000 })).toBeNull();
    expect(issue({ sessionExpiresAt: NaN })).toBeNull();
    expect(issue({}, { ...actor, tenant: 'tenant-1' })).toBeNull();
    expect(issue({}, { ...actor, userId: 'nope' })).toBeNull();
    expect(issue({}, { ...actor, sessionId: '' })).toBeNull();
    expect(issue({}, { ...actor, userType: 'service' as any })).toBeNull();
    expect(issue({ secret: '' })).toBeNull();
  });

  it('round-trips through the hocuspocus room validator, bound to its own room only', () => {
    process.env.HOCUSPOCUS_JWT_SECRET = secret;
    const { token } = issue()!;
    const request = new Request(`http://localhost/hocuspocus?token=${token}`);
    expect(validateNotificationSignalRoom(room, request, { now: NOW })).toMatchObject({
      status: 'ok', tenantId: tenant, userId: user, sessionId,
    });
    const other = '44444444-4444-4444-8444-444444444444';
    expect(() => validateNotificationSignalRoom(`notification-signals:${tenant}:${other}`, request, { now: NOW })).toThrow();
    expect(() => validateNotificationSignalRoom(`notification-signals:${other}:${user}`, request, { now: NOW })).toThrow();
  });

  it('tolerates +-60s of clock skew between issuer and verifier, and no more', () => {
    process.env.HOCUSPOCUS_JWT_SECRET = secret;
    const { token } = issue()!;
    const request = new Request(`http://localhost/hocuspocus?token=${token}`);
    // Verifier clock behind the issuer (token iat in the verifier's future).
    expect(validateNotificationSignalRoom(room, request, { now: NOW - 60_000 }).status).toBe('ok');
    expect(() => validateNotificationSignalRoom(room, request, { now: NOW - 61_000 })).toThrow();
    // Verifier clock ahead: still accepted up to 60s after exp.
    expect(validateNotificationSignalRoom(room, request, { now: NOW + 360_000 }).status).toBe('ok');
    expect(() => validateNotificationSignalRoom(room, request, { now: NOW + 361_000 })).toThrow();
  });
});
