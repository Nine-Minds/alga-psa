import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const NOTIFICATION_SIGNALS = 'notification-signals';
/** Hard cap on a token's lifetime; hocuspocus enforces the same number from the claims. */
export const NOTIFICATION_LIVE_TOKEN_TTL_SECONDS = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NotificationSessionActor {
  tenant: string;
  userId: string;
  sessionId: string;
  userType: 'internal' | 'client';
}

export interface NotificationLiveTokenOptions {
  /** HS256 secret shared with hocuspocus (HOCUSPOCUS_JWT_SECRET). */
  secret: string;
  /** Epoch milliseconds; injectable so the clamp and skew rules are testable. */
  now?: number;
  /** Seconds; never more than NOTIFICATION_LIVE_TOKEN_TTL_SECONDS. */
  ttlSeconds?: number;
  /** Epoch milliseconds at which the underlying browser session ends. */
  sessionExpiresAt: number;
}

export interface NotificationLiveToken {
  token: string;
  expiresAt: number;
  tenant: string;
  userId: string;
}

// LEVERAGE: pattern hocuspocus-join-token — second issuer of the same shape as
// server/src/app/api/tickets/[id]/live-token/route.ts (short TTL, audience+scope,
// room-bound claims). The missing layer is one
// issueHocuspocusJoinToken({ audience, scope, claims, ttl, sessionExpiresAt }) used by both.

/**
 * Pure signer. It does no I/O: the caller (the route) has already proven the
 * session is live through getSession(), which enforces revocation, owner and
 * user_type. The token grants only content-free refresh signals for the user's
 * own inbox; every notification read still performs its own authorization.
 *
 * Returns null when the input is malformed or the session has no lifetime left.
 */
export function issueNotificationLiveToken(
  actor: NotificationSessionActor,
  options: NotificationLiveTokenOptions,
): NotificationLiveToken | null {
  if (
    !actor ||
    ![actor.tenant, actor.userId, actor.sessionId].every((id) => typeof id === 'string' && UUID.test(id)) ||
    !['internal', 'client'].includes(actor.userType) ||
    !options?.secret ||
    !Number.isFinite(options.sessionExpiresAt)
  ) {
    return null;
  }

  const ttl = Math.min(options.ttlSeconds ?? NOTIFICATION_LIVE_TOKEN_TTL_SECONDS, NOTIFICATION_LIVE_TOKEN_TTL_SECONDS);
  const iat = Math.floor((options.now ?? Date.now()) / 1000);
  const exp = Math.min(iat + ttl, Math.floor(options.sessionExpiresAt / 1000));
  if (!Number.isSafeInteger(exp) || exp <= iat) return null;

  const token = jwt.sign(
    {
      scope: NOTIFICATION_SIGNALS,
      tenantId: actor.tenant,
      userId: actor.userId,
      sessionId: actor.sessionId,
      iat,
      exp,
    },
    options.secret,
    { algorithm: 'HS256', audience: NOTIFICATION_SIGNALS, jwtid: randomUUID() },
  );
  return { token, expiresAt: exp * 1000, tenant: actor.tenant, userId: actor.userId };
}
