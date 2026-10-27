import jwt from 'jsonwebtoken'
import { getHocuspocusJwtSecret } from './hocuspocusJwtSecret.js'

export function parseDocumentRoom(roomName) {
  if (!roomName || !roomName.startsWith('document:')) {
    return null;
  }
  const parts = roomName.split(':');
  if (parts.length !== 3) {
    return null;
  }
  const [, tenantId, documentId] = parts;
  if (!tenantId || !documentId) {
    return null;
  }
  return { tenantId, documentId };
}

export function parseTicketRoom(roomName) {
  if (!roomName || !roomName.startsWith('ticket:')) {
    return null;
  }

  const parts = roomName.split(':');
  if (parts.length !== 3) {
    return null;
  }

  const [, tenantId, ticketId] = parts;
  if (!tenantId || !ticketId) {
    return null;
  }

  return { tenantId, ticketId };
}

export function getTenantFromRequest(request) {
  if (!request?.url) {
    return null;
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    return url.searchParams.get('tenantId');
  } catch (error) {
    console.error('[Hocuspocus] Failed to parse request URL for tenant validation:', error);
    return null;
  }
}

export function validateDocumentRoomAccess(roomName, request, options) {
  // LEVERAGE: friction legacy-notification-room-window — the only reason the old
  // Yjs relay survives; delete this branch, the flag and the relay together when
  // the rollout window closes.
  if (roomName?.startsWith('notifications:')) {
    return validateLegacyNotificationRoom(roomName, request, options);
  }
  if (roomName?.startsWith('notification-signals:')) {
    return validateNotificationSignalRoom(roomName, request, options);
  }

  const parsedTicketRoom = parseTicketRoom(roomName);
  if (parsedTicketRoom) {
    if (!request?.url) {
      throw new Error('Ticket validation failed: missing request URL');
    }

    let token = null;
    try {
      const url = new URL(request.url, 'http://localhost');
      token = url.searchParams.get('token');
    } catch (error) {
      console.error('[Hocuspocus] Failed to parse request URL for ticket validation:', error);
      throw new Error('Ticket validation failed: invalid request URL');
    }

    if (!token) {
      throw new Error('Ticket validation failed: missing token');
    }

    let claims;
    try {
      claims = jwt.verify(token, getHocuspocusJwtSecret());
    } catch (error) {
      throw new Error(`Ticket validation failed: ${error instanceof Error ? error.message : 'invalid token'}`);
    }

    if (claims?.tenantId !== parsedTicketRoom.tenantId) {
      throw new Error('Ticket validation failed: room tenant mismatch');
    }

    if (claims?.ticketId !== parsedTicketRoom.ticketId) {
      throw new Error('Ticket validation failed: room ticket mismatch');
    }

    return {
      status: 'ok',
      tenantId: parsedTicketRoom.tenantId,
      ticketId: parsedTicketRoom.ticketId,
      userId: claims.userId,
    };
  }

  const parsedRoom = parseDocumentRoom(roomName);
  if (!parsedRoom) {
    return { status: 'bypass', reason: 'non-document' };
  }

  const tenantFromRequest = getTenantFromRequest(request);
  if (!tenantFromRequest) {
    throw new Error('Tenant validation failed: missing tenantId');
  }

  if (tenantFromRequest !== parsedRoom.tenantId) {
    throw new Error('Tenant validation failed: room tenant mismatch');
  }

  return {
    status: 'ok',
    tenantId: tenantFromRequest,
    documentId: parsedRoom.documentId,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTIFICATION_SIGNALS = 'notification-signals';
/** Lifetime ceiling, measured from the claims only (exp - iat). */
export const MAX_SIGNAL_TTL_SECONDS = 300;
/** Leeway for the two comparisons that cross a clock boundary (iat, exp). */
export const SIGNAL_CLOCK_TOLERANCE_SECONDS = 60;

// LEVERAGE: pattern hocuspocus-room-validation — ticket and signal validators now
// repeat "parse room -> take ?token= -> verify -> compare claims to room segments";
// one table-driven validator is the shape.

function parseNotificationRoom(roomName, prefix) {
  const parts = typeof roomName === 'string' ? roomName.split(':') : [];
  if (parts.length !== 3 || parts[0] !== prefix || !UUID.test(parts[1]) || !UUID.test(parts[2])) return null;
  return { tenantId: parts[1], userId: parts[2] };
}

function getRequestToken(request) {
  try {
    return new URL(request?.url || '', 'http://localhost').searchParams.get('token');
  } catch {
    throw new Error('Notification validation failed: invalid request URL');
  }
}

/** Verifies a notification-signals token against the room's tenant and user. */
function verifyNotificationToken(token, room, now) {
  const nowSeconds = Math.floor(now / 1000);
  let claims;
  try {
    claims = jwt.verify(token, getHocuspocusJwtSecret(), {
      algorithms: ['HS256'],
      audience: NOTIFICATION_SIGNALS,
      // exp is judged below with the same inclusive +-60s leeway as iat;
      // jsonwebtoken's own check is exclusive at the boundary.
      ignoreExpiration: true,
    });
  } catch (error) {
    throw new Error(`Notification validation failed: ${error instanceof Error ? error.message : 'invalid token'}`);
  }
  if (
    claims?.scope !== NOTIFICATION_SIGNALS ||
    claims.tenantId !== room.tenantId ||
    claims.userId !== room.userId ||
    typeof claims.sessionId !== 'string' || !UUID.test(claims.sessionId) ||
    !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
    // Lifetime comes from the claims alone, so a fast or slow issuer clock cannot stretch it.
    claims.exp <= claims.iat || claims.exp - claims.iat > MAX_SIGNAL_TTL_SECONDS ||
    // Absolute instants compare two clocks (web vs hocuspocus), so they get leeway.
    claims.iat > nowSeconds + SIGNAL_CLOCK_TOLERANCE_SECONDS ||
    claims.exp < nowSeconds - SIGNAL_CLOCK_TOLERANCE_SECONDS
  ) {
    throw new Error('Notification validation failed: room or token scope mismatch');
  }
  return claims;
}

export function validateNotificationSignalRoom(roomName, request, { now = Date.now() } = {}) {
  const room = parseNotificationRoom(roomName, NOTIFICATION_SIGNALS);
  if (!room) throw new Error('Invalid notification signal room');
  const token = getRequestToken(request);
  if (!token) throw new Error('Notification validation failed: missing token');
  const claims = verifyNotificationToken(token, room, now);
  return {
    status: 'ok',
    tenantId: room.tenantId,
    userId: room.userId,
    sessionId: claims.sessionId,
    expiresAt: claims.exp * 1000,
  };
}

export function isLegacyNotificationRoomsEnabled() {
  return process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS === 'true';
}

/**
 * Legacy `notifications:<tenant>:<user>` rooms. Denied unless the rollout
 * window flag is set. Bundles that predate the signal rooms hold no credential,
 * so an open window admits a tokenless join (UUID segments only); a join that
 * does present a token must still verify and match the room.
 */
export function validateLegacyNotificationRoom(roomName, request, { now = Date.now() } = {}) {
  if (!isLegacyNotificationRoomsEnabled()) {
    throw new Error('Legacy notification rooms are no longer supported');
  }
  const room = parseNotificationRoom(roomName, 'notifications');
  if (!room) throw new Error('Invalid legacy notification room');
  const token = getRequestToken(request);
  if (token) verifyNotificationToken(token, room, now);
  return { status: 'ok', legacy: true, tenantId: room.tenantId, userId: room.userId };
}
