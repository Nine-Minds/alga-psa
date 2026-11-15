import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  parseTicketRoom,
  validateDocumentRoomAccess,
} from '../../../../../hocuspocus/tenantValidation.js';

describe('ticket room validation', () => {
  beforeEach(() => {
    process.env.HOCUSPOCUS_JWT_SECRET = 'tenant-validation-secret';
    process.env.NODE_ENV = 'test';
  });

  it('T015: parseTicketRoom parses valid names and rejects malformed names', () => {
    expect(parseTicketRoom('ticket:tenant1:abc-123')).toEqual({
      tenantId: 'tenant1',
      ticketId: 'abc-123',
    });
    expect(parseTicketRoom('ticket:tenant1')).toBeNull();
    expect(parseTicketRoom('document:tenant1:abc-123')).toBeNull();
  });

  it('T011: rejects JWTs signed with the wrong secret', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        ticketId: 'ticket-1',
      },
      'wrong-secret',
      { expiresIn: '5m' }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-1:ticket-1',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('Ticket validation failed');
  });

  it('T012: rejects expired JWTs', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        ticketId: 'ticket-1',
      },
      'tenant-validation-secret',
      { expiresIn: -1 }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-1:ticket-1',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('expired');
  });

  it('T013: rejects tenant mismatches between the JWT and the ticket room', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-x',
        userId: 'user-1',
        ticketId: 'ticket-1',
      },
      'tenant-validation-secret',
      { expiresIn: '5m' }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-y:ticket-1',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('room tenant mismatch');
  });

  it('T014: rejects ticket mismatches between the JWT and the ticket room', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        ticketId: 'ticket-a',
      },
      'tenant-validation-secret',
      { expiresIn: '5m' }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-1:ticket-b',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('room ticket mismatch');
  });

  it('T016: notifications rooms are refused by default instead of bypassing validation', () => {
    delete process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS;
    return expect(
      validateDocumentRoomAccess(
        'notifications:tenant-1:user-1',
        new Request('http://localhost/hocuspocus')
      )
    ).rejects.toThrow('Legacy notification rooms');
  });

  it('T017: document room validation still uses tenantId from the request query', () => {
    expect(
      validateDocumentRoomAccess(
        'document:tenant-1:doc-1',
        new Request('http://localhost/hocuspocus?tenantId=tenant-1')
      )
    ).toEqual({
      status: 'ok',
      tenantId: 'tenant-1',
      documentId: 'doc-1',
    });
  });

  it('T021: handshake validation rejects a ticket room when the token targets another tenant', () => {
    const token = jwt.sign(
      {
        tenantId: 'tenant-x',
        userId: 'user-1',
        ticketId: 'ticket-1',
      },
      'tenant-validation-secret',
      { expiresIn: '5m' }
    );

    expect(() =>
      validateDocumentRoomAccess(
        'ticket:tenant-y:ticket-1',
        new Request(`http://localhost/hocuspocus?token=${token}`)
      )
    ).toThrow('room tenant mismatch');
  });
});

describe('notification signal room validation', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const user = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const secret = 'tenant-validation-secret';
  const room = `notification-signals:${tenant}:${user}`;
  const NOW = 1_800_000_000_000;
  const now = Math.floor(NOW / 1000);

  function req(claims: Record<string, unknown> = {}, signingSecret = secret, audience: string | null = 'notification-signals') {
    const token = jwt.sign(
      { scope: 'notification-signals', tenantId: tenant, userId: user, sessionId, iat: now, exp: now + 300, ...claims },
      signingSecret,
      { algorithm: 'HS256', ...(audience ? { audience } : {}) }
    );
    return new Request(`http://localhost/hocuspocus?token=${token}`);
  }
  const validate = (r: Request, name = room) => validateDocumentRoomAccess(name, r, { now: NOW });

  beforeEach(() => {
    process.env.HOCUSPOCUS_JWT_SECRET = secret;
    process.env.NODE_ENV = 'test';
  });

  it('accepts matching segments and returns the bound identity and expiry', () => {
    expect(validate(req())).toEqual({
      status: 'ok', tenantId: tenant, userId: user, sessionId, expiresAt: (now + 300) * 1000,
    });
  });

  it('refuses a mismatched tenant or user in the room name', () => {
    const otherUuid = '44444444-4444-4444-8444-444444444444';
    expect(() => validate(req(), `notification-signals:${otherUuid}:${user}`)).toThrow('scope mismatch');
    expect(() => validate(req(), `notification-signals:${tenant}:${otherUuid}`)).toThrow('scope mismatch');
  });

  it('refuses a token whose claims name another tenant, user, scope or session', () => {
    expect(() => validate(req({ tenantId: '44444444-4444-4444-8444-444444444444' }))).toThrow();
    expect(() => validate(req({ userId: '44444444-4444-4444-8444-444444444444' }))).toThrow();
    expect(() => validate(req({ scope: 'ticket' }))).toThrow();
    expect(() => validate(req({ sessionId: 'not-a-uuid' }))).toThrow();
  });

  it('refuses missing, garbage, wrongly signed, wrong-audience and ticket-room tokens', () => {
    expect(() => validate(new Request('http://localhost/hocuspocus'))).toThrow('missing token');
    expect(() => validate(new Request('http://localhost/hocuspocus?token=garbage'))).toThrow('Notification validation failed');
    expect(() => validate(req({}, 'wrong-secret'))).toThrow('Notification validation failed');
    expect(() => validate(req({}, secret, 'ticket-room'))).toThrow('Notification validation failed');
    expect(() => validate(req({}, secret, null))).toThrow('Notification validation failed');
    const ticketToken = jwt.sign({ tenantId: tenant, userId: user, ticketId: 'x' }, secret, { expiresIn: '5m' });
    expect(() => validate(new Request(`http://localhost/hocuspocus?token=${ticketToken}`))).toThrow();
  });

  it('refuses malformed room names', () => {
    for (const name of [
      'notification-signals:',
      `notification-signals:${tenant}`,
      `notification-signals:${tenant}:${user}:extra`,
      `notification-signals:not-a-uuid:${user}`,
      `notification-signals:${tenant}:not-a-uuid`,
    ]) {
      expect(() => validate(req(), name)).toThrow('Invalid notification signal room');
    }
  });

  it('judges lifetime only by exp - iat, capped at 300s', () => {
    expect(validate(req({ iat: now, exp: now + 300 })).status).toBe('ok');
    expect(() => validate(req({ iat: now, exp: now + 301 }))).toThrow('scope mismatch');
    expect(() => validate(req({ iat: now, exp: now }))).toThrow();
    // An issuer clock 50s fast does not change the lifetime, so a 300s token is fine.
    expect(validate(req({ iat: now + 50, exp: now + 350 })).status).toBe('ok');
    // ...but it cannot stretch an hour-long token that looks 'short' from the verifier's clock.
    expect(() => validate(req({ iat: now - 3300, exp: now + 300 }))).toThrow('scope mismatch');
  });

  it('allows +-60s tolerance on absolute iat and exp, and no more', () => {
    expect(validate(req({ iat: now + 60, exp: now + 360 })).status).toBe('ok');
    expect(() => validate(req({ iat: now + 61, exp: now + 361 }))).toThrow();
    expect(validate(req({ iat: now - 360, exp: now - 60 })).status).toBe('ok');
    expect(() => validate(req({ iat: now - 361, exp: now - 61 }))).toThrow();
  });

  it('does not reject a token whose exp is far past now+60 when the lifetime is within the cap', () => {
    // The reference's `exp > now + 60` clause would refuse this live 300s token.
    expect(validate(req({ iat: now, exp: now + 300 })).status).toBe('ok');
  });

  describe('legacy notifications: rooms', () => {
    const legacy = `notifications:${tenant}:${user}`;
    afterEach(() => { delete process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS; });

    it('are refused with the flag unset, even with a valid token', async () => {
      await expect(validate(req(), legacy)).rejects.toThrow('Legacy notification rooms');
    });

    it('with the flag, are admitted only for a token that verifies and names this room', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      await expect(validate(req(), legacy)).resolves.toMatchObject({ status: 'ok', legacy: true, sessionId, expiresAt: (now + 300) * 1000 });
      await expect(validate(req(), `notifications:${tenant}:44444444-4444-4444-8444-444444444444`)).rejects.toThrow('scope mismatch');
      await expect(validate(req(), `notifications:44444444-4444-4444-8444-444444444444:${user}`)).rejects.toThrow('scope mismatch');
      await expect(validate(req({}, 'wrong-secret'), legacy)).rejects.toThrow();
      // The same skew rule as signal rooms.
      await expect(validate(req({ iat: now - 361, exp: now - 61 }), legacy)).rejects.toThrow();
      await expect(validate(req(), 'notifications:t:u')).rejects.toThrow('Invalid legacy notification room');
    });

    it('with the flag, refuse a tokenless join that carries no session', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      process.env.NOTIFICATION_LIVE_TOKEN_URL = 'http://web.internal/api/notifications/live-token';
      try {
        await expect(validate(new Request('http://localhost/hocuspocus'), legacy)).rejects.toThrow('missing session');
      } finally { delete process.env.NOTIFICATION_LIVE_TOKEN_URL; }
    });
  });
});
