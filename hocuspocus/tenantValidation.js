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
    return { status: 'bypass', reason: 'notifications' };
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
