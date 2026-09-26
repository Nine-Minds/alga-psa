import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { runWithTenant } from '@alga-psa/db';
import { buildDocumentMarkdown } from '@alga-psa/documents/lib/documentMarkdownExport';
import { createPDFGenerationService } from '@alga-psa/billing/services';
import { getClientDocumentContent } from '@alga-psa/client-portal/actions/client-portal-actions/client-documents';

// LEVERAGE: pattern document-byte-serving

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.tenant) return NextResponse.json({ error: 'Sign in to access this document.', code: 'unauthorized' }, { status: 401 });
  if (user.user_type !== 'client') return NextResponse.json({ error: 'Client portal access is required.', code: 'forbidden' }, { status: 403 });
  const { documentId } = await params;
  return runWithTenant(user.tenant, async () => {
    const result = await getClientDocumentContent(documentId);
    if (!result || 'actionError' in result || 'permissionError' in result) return NextResponse.json({ error: 'Document not found or unavailable.', code: 'not_found' }, { status: 404 });
    if (result.content.kind === 'file') return NextResponse.json({ error: 'Uploaded files use the file download route.', code: 'not_in_app_document' }, { status: 400 });
    const format = request.nextUrl.searchParams.get('format');
    const name = result.document.document_name || 'document';
    if (format === 'md') {
      const markdown = buildDocumentMarkdown(result.content.kind === 'block' ? result.content.blockData : null, result.content.kind === 'text' ? result.content.content : null);
      if (!markdown?.trim()) return NextResponse.json({ error: 'This document has no content to export.', code: 'no_content' }, { status: 404 });
      const headers = new Headers({ 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="document.md"; filename*=UTF-8''${encodeURIComponent(name)}.md`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return new Response(markdown, { headers });
    }
    if (format === 'pdf') {
      if (result.content.kind === 'empty') return NextResponse.json({ error: 'This document has no content to export.', code: 'no_content' }, { status: 404 });
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
