import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { runWithTenant } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { downloadClientDocument } from '@alga-psa/client-portal/actions/client-portal-actions/client-documents';

// LEVERAGE: pattern document-byte-serving

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.tenant) return NextResponse.json({ error: 'Sign in to access this document.', code: 'unauthorized' }, { status: 401 });
  if (user.user_type !== 'client') return NextResponse.json({ error: 'Client portal access is required.', code: 'forbidden' }, { status: 403 });
  const { documentId } = await params;
  return runWithTenant(user.tenant, async () => {
    const authorized = await downloadClientDocument(documentId);
    if (!authorized || 'actionError' in authorized || 'permissionError' in authorized) return NextResponse.json({ error: 'Document not found or unavailable.', code: 'not_found' }, { status: 404 });
    if (!authorized.file_id) return NextResponse.json({ error: 'This document has no uploaded file.', code: 'no_file' }, { status: 404 });
    const disposition = request.nextUrl.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
    const mime = String(authorized.mime_type || 'application/octet-stream').toLowerCase();
    if (disposition === 'inline' && !(mime === 'application/pdf' || (mime.startsWith('image/') && mime !== 'image/svg+xml'))) return NextResponse.json({ error: 'Preview is unavailable for this file type.', code: 'unsupported_preview' }, { status: 415 });
    const stored = await StorageService.downloadFile(authorized.file_id).catch(() => null);
    if (!stored?.buffer) return NextResponse.json({ error: 'The uploaded file is missing from storage.', code: 'missing_file' }, { status: 404 });
    const name = authorized.document_name || 'document';
    const ext = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : mime === 'image/gif' ? '.gif' : mime === 'image/webp' ? '.webp' : '';
    const filename = /\.[a-z0-9]{1,8}$/i.test(name) || !ext ? name : name + ext;
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
    const headers = new Headers({ 'Content-Type': mime, 'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Content-Length': String(stored.buffer.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    if (disposition === 'inline') headers.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    return new Response(stored.buffer as any, { headers });
  });
}
