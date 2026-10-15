import { createHmac, timingSafeEqual } from 'node:crypto';
export interface AttachmentLinkClaims {
  tenant: string; ticketId: string; commentId: string; documentId: string; recipient: string; expiresAt: number;
}
export function signAttachmentLink(claims: AttachmentLinkClaims, secret: string): string {
  if (!secret) throw new Error('Attachment link signing secret is missing');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(`ticket-comment-attachment:v1:${body}`).digest('base64url')}`;
}
export function verifyAttachmentLink(token: string, secret: string, recipient?: string, now = Date.now()): AttachmentLinkClaims | null {
  if (!secret || token.length > 4096) return null;
  try {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) return null;
    const expected = createHmac('sha256', secret).update(`ticket-comment-attachment:v1:${body}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as AttachmentLinkClaims;
    if (!Number.isFinite(claims.expiresAt) || claims.expiresAt <= now ||
      typeof claims.recipient !== 'string' || !claims.recipient.includes('@') ||
      (recipient !== undefined && claims.recipient !== recipient.trim().toLowerCase()) ||
      ![claims.tenant, claims.ticketId, claims.commentId, claims.documentId].every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))) return null;
    return claims;
  } catch { return null; }
}
