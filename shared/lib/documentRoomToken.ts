import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export interface DocumentRoomClaims extends jwt.JwtPayload {
  scope: 'document-room';
  tenantId: string;
  documentId: string;
  userId: string;
}

export const DOCUMENT_ROOM_TOKEN_TTL_SECONDS = 900;

export function signDocumentRoomToken(input: { tenantId: string; documentId: string; userId: string }): string {
  const secret = process.env.HOCUSPOCUS_JWT_SECRET || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('HOCUSPOCUS_JWT_SECRET is required in production'); })()
    : 'dev-hocuspocus-jwt-secret');
  return jwt.sign({ ...input, scope: 'document-room' }, secret, {
    algorithm: 'HS256',
    audience: 'document-room',
    issuer: 'alga-psa',
    // The Hocuspocus protocol does not reauthenticate an already-open socket.
    // Active edits are reauthorized on every message; reconnects request a new
    // token and expired tokens cannot start another session.
    expiresIn: DOCUMENT_ROOM_TOKEN_TTL_SECONDS,
    jwtid: randomUUID(),
  });
}

export function verifyDocumentRoomToken(token: string): DocumentRoomClaims {
  const secret = process.env.HOCUSPOCUS_JWT_SECRET || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('HOCUSPOCUS_JWT_SECRET is required in production'); })()
    : 'dev-hocuspocus-jwt-secret');
  const claims = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    audience: 'document-room',
    issuer: 'alga-psa',
  }) as DocumentRoomClaims;
  if (claims.scope !== 'document-room' || !claims.tenantId || !claims.documentId || !claims.userId || !claims.jti) {
    throw new Error('Invalid document room credential');
  }
  return claims;
}
