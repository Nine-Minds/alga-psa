import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const TICKET_CHANGES_ROOM_PREFIX = 'tenant:';
export const TICKET_CHANGES_SCOPE = 'ticket-changes';

export function issueTicketChangesLiveToken(input: {
  tenantId: string; userId: string; sessionId: string; secret: string; sessionExpiresAt: number; now?: number;
}) {
  const { tenantId, userId, sessionId, secret, sessionExpiresAt, now = Date.now() } = input;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (![tenantId, userId, sessionId].every(value => uuid.test(value)) || !secret || !Number.isFinite(sessionExpiresAt)) return null;
  const iat = Math.floor(now / 1000);
  const exp = Math.min(iat + 300, Math.floor(sessionExpiresAt / 1000));
  if (exp <= iat) return null;
  const token = jwt.sign({ scope: TICKET_CHANGES_SCOPE, tenantId, userId, sessionId, iat, exp }, secret,
    { algorithm: 'HS256', audience: TICKET_CHANGES_SCOPE, jwtid: randomUUID() });
  return { token, expiresAt: exp * 1000, expiresInMs: exp * 1000 - now };
}
