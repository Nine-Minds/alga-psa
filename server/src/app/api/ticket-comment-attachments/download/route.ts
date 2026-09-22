import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { TenantEmailService, StaticTemplateProcessor } from '@alga-psa/email';
import { verifyAttachmentLink } from '@shared/lib/ticketCommentAttachmentToken';
import { attachmentSigningSecret, authorizedRecipientCommentDocument } from '@/lib/notifications/ticketCommentAttachmentEmail';
import { issueAttachmentChallenge, redeemAttachmentChallenge } from '@/lib/notifications/ticketCommentAttachmentVerification';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const cookieName = 'attachment-verification';
function verificationPage(token: string, code = false, message = '') {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Download attachment</title></head><body><main><h1>Download attachment</h1><p>${escape(message || (code ? 'Enter the six-digit code sent to the email address that received the attachment link.' : 'Verify your email to download this attachment. A portal account is not required.'))}</p><form method="post"><input type="hidden" name="token" value="${escape(token)}"><input type="hidden" name="action" value="${code ? 'verify' : 'send'}">${code ? '<label for="attachment-code">Email code</label><input id="attachment-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>' : ''}<button id="attachment-verify-submit" type="submit">${code ? 'Download' : 'Send verification code'}</button></form></main></body></html>`, { headers: { ...headers, 'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
}
const denied = () => new NextResponse('Attachment link is invalid, expired, or no longer available.', { status: 403, headers });
async function download(document: any, tenant: string) {
  const file = await runWithTenant(tenant, () => StorageService.downloadFile(document.file_id));
  return new NextResponse(new Uint8Array(file.buffer), { headers: { ...headers,
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.document_name)}`,
  } });
}
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const claims = verifyAttachmentLink(token, await attachmentSigningSecret());
  if (!claims) return denied();
  const user = await getCurrentUser();
  if (!user) return verificationPage(token);
  if (user.tenant !== claims.tenant || user.email?.trim().toLowerCase() !== claims.recipient) return denied();
  const { knex } = await createTenantKnex(claims.tenant);
  const document = await authorizedRecipientCommentDocument(knex, claims.tenant, claims.ticketId, claims.commentId, claims.documentId, claims.recipient);
  return document?.file_id ? download(document, claims.tenant) : denied();
}
export async function POST(request: NextRequest) {
  // Prevent cross-origin code requests; token and HttpOnly browser nonce protect redemption.
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return denied();
  const form = await request.formData();
  const token = String(form.get('token') || '');
  const secret = await attachmentSigningSecret();
  const claims = verifyAttachmentLink(token, secret);
  if (!claims) return denied();
  const { knex } = await createTenantKnex(claims.tenant);
  const currentDocument = () => authorizedRecipientCommentDocument(knex, claims.tenant, claims.ticketId, claims.commentId, claims.documentId, claims.recipient);
  if (!await currentDocument()) return denied();
  if (form.get('action') === 'send') {
    try {
      const browser = await issueAttachmentChallenge(knex, claims, token, secret, async code => {
        const text = `Your attachment download code is ${code}. It expires in ten minutes. If you did not request it, ignore this email.`;
        const result = await TenantEmailService.getInstance(claims.tenant).sendEmail({
          tenantId: claims.tenant, to: claims.recipient,
          templateProcessor: new StaticTemplateProcessor('Your attachment download code', `<p>${text}</p>`, text),
        });
        if (!result.success || result.queued) throw new Error('Verification email could not be sent.');
      });
      const response = verificationPage(token, true);
      response.cookies.set(cookieName, browser, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', maxAge: 600, path: '/api/ticket-comment-attachments/download' });
      return response;
    } catch {
      return new NextResponse('Unable to send a verification code. Please retry in one minute.', { status: 429, headers });
    }
  }
  if (form.get('action') !== 'verify' || !await redeemAttachmentChallenge(knex, claims, token, secret, request.cookies.get(cookieName)?.value || '', String(form.get('code') || ''))) return denied();
  const document = await currentDocument();
  return document?.file_id ? download(document, claims.tenant) : denied();
}
