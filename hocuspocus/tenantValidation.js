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

export function validateDocumentRoomAccess(roomName, request) {
  if (roomName?.startsWith('notifications:')) {
    throw new Error('Legacy notification rooms are no longer supported');
  }
  if (roomName?.startsWith('notification-signals:')) {
    return validateNotificationSignalRoom(roomName, request);
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


export function validateNotificationSignalRoom(roomName, request) {
  const parts = typeof roomName === 'string' ? roomName.split(':') : [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (parts.length !== 3 || parts[0] !== 'notification-signals' || !uuid.test(parts[1]) || !uuid.test(parts[2])) {
    throw new Error('Invalid notification signal room');
  }
  const token = new URL(request?.url || '', 'http://localhost').searchParams.get('token');
  if (!token) throw new Error('Notification validation failed: missing token');
  const claims = jwt.verify(token, getHocuspocusJwtSecret(), { algorithms: ['HS256'], audience: 'notification-signals' });
  if (claims.scope !== 'notification-signals' || claims.tenantId !== parts[1] || claims.userId !== parts[2] ||
    !uuid.test(claims.sessionId) || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
    claims.exp <= claims.iat || claims.exp - claims.iat > 60 || claims.exp > Math.floor(Date.now() / 1000) + 60) throw new Error('Notification validation failed: room or token scope mismatch');
  return { status: 'ok', tenantId: parts[1], userId: parts[2], expiresAt: claims.exp * 1000 };
}
