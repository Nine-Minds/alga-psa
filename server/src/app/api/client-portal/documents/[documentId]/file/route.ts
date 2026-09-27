import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getConnection, runWithTenant, withTransaction } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { resolveClientPortalDocument } from '@alga-psa/client-portal/lib/clientDocumentAccess';
import type { IUser } from '@alga-psa/types';

// LEVERAGE: pattern document-byte-serving

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'application/pdf': '.pdf', 'application/json': '.json', 'application/ld+json': '.json',
  'application/zip': '.zip', 'application/x-zip-compressed': '.zip', 'application/rtf': '.rtf',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt', 'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv', 'text/html': '.html', 'text/xml': '.xml',
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/tiff': '.tiff',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'video/mp4': '.mp4', 'video/quicktime': '.mov',
};

function ensureUsableExtension(name: string, mimeType: string): string {
  if (/\.[a-z0-9]{1,12}$/i.test(name)) return name;
  const extension = EXTENSION_BY_MIME_TYPE[mimeType] || '';
  return extension ? `${name}${extension}` : name;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.tenant) return NextResponse.json({ error: 'Sign in to access this document.', code: 'unauthorized' }, { status: 401 });
  if (user.user_type !== 'client') return NextResponse.json({ error: 'Client portal access is required.', code: 'forbidden' }, { status: 403 });
  const { documentId } = await params;
  return runWithTenant(user.tenant, async () => {
    const db = await getConnection(user.tenant);
    let authorized;
    try {
      authorized = await withTransaction(db, (trx) => resolveClientPortalDocument(trx, user.tenant!, user as IUser, documentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/access denied|insufficient permissions|not associated with a (?:contact|client)/i.test(message)) {
        return NextResponse.json({ error: 'You do not have access to this document.', code: 'forbidden' }, { status: 403 });
      }
      return NextResponse.json({ error: 'Could not verify document access.', code: 'access_check_failed' }, { status: 500 });
    }
    if (!authorized) return NextResponse.json({ error: 'Document not found or unavailable.', code: 'not_found' }, { status: 404 });
    if (!authorized.file_id) return NextResponse.json({ error: 'This document has no uploaded file.', code: 'no_file' }, { status: 404 });
    const disposition = request.nextUrl.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
    const mime = String(authorized.mime_type || 'application/octet-stream').toLowerCase();
    if (disposition === 'inline' && !(mime === 'application/pdf' || (mime.startsWith('image/') && mime !== 'image/svg+xml'))) return NextResponse.json({ error: 'Preview is unavailable for this file type.', code: 'unsupported_preview' }, { status: 415 });
    const stored = await StorageService.downloadFile(authorized.file_id).catch(() => null);
    if (!stored?.buffer) return NextResponse.json({ error: 'The uploaded file is missing from storage.', code: 'missing_file' }, { status: 404 });
    const originalName = stored.metadata.original_name?.split(/[\\/]/).pop()?.trim();
    const filename = ensureUsableExtension(originalName || authorized.document_name || 'document', mime);
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_').replace(/[\r\n]/g, '_');
    const headers = new Headers({ 'Content-Type': mime, 'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Content-Length': String(stored.buffer.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    if (disposition === 'inline') headers.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    return new Response(stored.buffer as any, { headers });
  });
}
