import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { issueTicketChangesLiveToken } from '../../../lib/notifications/ticketChangesLiveToken';

const actor = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
};

describe('ticket changes room token', () => {
  it('binds the room, actor, live session, and a maximum five minute lifetime', () => {
    const now = 1_800_000_000_000;
    const issued = issueTicketChangesLiveToken({ ...actor, secret: 'secret', sessionExpiresAt: now + 3_600_000, now })!;
    expect(jwt.verify(issued.token, 'secret', { audience: 'ticket-changes' })).toMatchObject({
      scope: 'ticket-changes', tenantId: actor.tenantId, userId: actor.userId, sessionId: actor.sessionId,
      exp: now / 1000 + 300,
    });
  });

  it('refuses malformed actors and sessions without remaining lifetime', () => {
    expect(issueTicketChangesLiveToken({ ...actor, userId: 'user', secret: 'secret', sessionExpiresAt: Date.now() + 60_000 })).toBeNull();
    expect(issueTicketChangesLiveToken({ ...actor, secret: 'secret', sessionExpiresAt: Date.now() - 1 })).toBeNull();
  });
});
