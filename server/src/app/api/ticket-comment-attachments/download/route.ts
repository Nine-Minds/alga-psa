import { hasPermission } from '@/lib/auth/rbac';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { createTenantKnex, tenantDb, withTransaction, runWithTenant } from '@alga-psa/db';
import { getAuthorizedDocumentById } from '@alga-psa/documents/actions/documentActions';
import { StorageService } from '@alga-psa/storage/StorageService';
import { verifyAttachmentLink } from '@shared/lib/ticketCommentAttachmentToken';
import { isPublicAttachmentComment } from '@shared/lib/ticketCommentAttachments';
import { attachmentSigningSecret, recipientCanReceiveCommentFiles } from '@/lib/notifications/ticketCommentAttachmentEmail';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.tenant || !user.email) return new NextResponse('Sign in with the email address that received this attachment link.', { status: 401 });
  if (!await hasPermission(user, 'document', 'read')) return new NextResponse('Forbidden', { status: 403 });
  const claims = verifyAttachmentLink(request.nextUrl.searchParams.get('token') || '', await attachmentSigningSecret(), user.email);
  if (!claims || claims.tenant !== user.tenant) return new NextResponse('Attachment link is invalid or expired.', { status: 403 });
  const { knex } = await createTenantKnex(user.tenant);
  const document = await withTransaction(knex, async trx => {
    const row = await tenantDb(trx, user.tenant!).table('ticket_comment_attachments').where({
      ticket_id: claims.ticketId, comment_id: claims.commentId, document_id: claims.documentId, state: 'attached',
    }).first();
    if (!row || !await isPublicAttachmentComment(trx, user.tenant!, claims.commentId, claims.ticketId) ||
      !await recipientCanReceiveCommentFiles(trx, user.tenant!, claims.ticketId, user.email!)) return null;
    return getAuthorizedDocumentById(trx, user.tenant!, user, claims.documentId);
  });
  if (!document?.file_id) return new NextResponse('Attachment is no longer available.', { status: 403 });
  const fileId = document.file_id;
  const file = await runWithTenant(user.tenant, () => StorageService.downloadFile(fileId));
  return new NextResponse(new Uint8Array(file.buffer), { headers: {
    'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.document_name)}`,
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  } });
}
