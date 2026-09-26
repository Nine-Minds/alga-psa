import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getConnection, runWithTenant, tenantDb, withTransaction } from '@alga-psa/db';
import { buildDocumentMarkdown } from '@alga-psa/documents/lib/documentMarkdownExport';
import { createPDFGenerationService } from '@alga-psa/billing/services';
import { resolveClientPortalDocument } from '@alga-psa/client-portal/lib/clientDocumentAccess';
import type { IUser } from '@alga-psa/types';

// LEVERAGE: pattern document-byte-serving

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.tenant) return NextResponse.json({ error: 'Sign in to access this document.', code: 'unauthorized' }, { status: 401 });
  if (user.user_type !== 'client') return NextResponse.json({ error: 'Client portal access is required.', code: 'forbidden' }, { status: 403 });
  const { documentId } = await params;
  return runWithTenant(user.tenant, async () => {
    const db = await getConnection(user.tenant!);
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
    if (authorized.file_id) return NextResponse.json({ error: 'Uploaded files use the file download route.', code: 'not_in_app_document' }, { status: 400 });
    const scopedDb = tenantDb(db, user.tenant!);
    const [block, text] = await Promise.all([
      scopedDb.table('document_block_content').where({ document_id: documentId }).first('block_data'),
      scopedDb.table('document_content').where({ document_id: documentId }).first('content'),
    ]);
    const content = block?.block_data != null ? { kind: 'block' as const, blockData: block.block_data } : text?.content != null ? { kind: 'text' as const, content: text.content } : { kind: 'empty' as const };
    const format = request.nextUrl.searchParams.get('format');
    const name = authorized.document_name || 'document';
    if (format === 'md') {
      const markdown = buildDocumentMarkdown(content.kind === 'block' ? content.blockData : null, content.kind === 'text' ? content.content : null);
      if (!markdown?.trim()) return NextResponse.json({ error: 'This document has no content to export.', code: 'no_content' }, { status: 404 });
      const headers = new Headers({ 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="document.md"; filename*=UTF-8''${encodeURIComponent(name)}.md`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return new Response(markdown, { headers });
    }
    if (format === 'pdf') {
      if (content.kind === 'empty') return NextResponse.json({ error: 'This document has no content to export.', code: 'no_content' }, { status: 404 });
      try {
        const pdf = await createPDFGenerationService(user.tenant).generatePDF({ documentId, userId: user.user_id });
        return new Response(pdf as any, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`, 'Content-Length': String(pdf.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      } catch {
        return NextResponse.json({ error: 'PDF export failed. Try Markdown instead.', code: 'export_failed' }, { status: 500 });
      }
    }
    return NextResponse.json({ error: 'Choose md or pdf format.', code: 'invalid_format' }, { status: 400 });
  });
}
