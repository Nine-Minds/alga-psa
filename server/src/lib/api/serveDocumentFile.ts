import { NextResponse } from 'next/server';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { buildDocumentMarkdown } from '@alga-psa/documents/lib/documentMarkdownExport';
import { createDocumentDownloadResponse } from '@alga-psa/documents/lib/documentDownloadResponse';

/**
 * Serve an already-authorized document: its stored file, or (block documents such as notes and
 * transcripts, which have no file) its content as Markdown. Authorization is the caller's job;
 * this runs after the route's document gates and never before them.
 */
export async function serveDocumentFile(
  document: { document_id: string; document_name?: string | null; file_id?: string | null },
  ctx: { knex: Knex; tenant: string },
): Promise<Response> {
  if (!document.file_id) {
    const blockRow = await tenantDb(ctx.knex, ctx.tenant)
      .table('document_block_content')
      .where({ document_id: document.document_id })
      .first('block_data');
    if (!blockRow) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    const blockData = typeof blockRow.block_data === 'string' ? JSON.parse(blockRow.block_data) : blockRow.block_data;
    const markdown = buildDocumentMarkdown(blockData, null) ?? '';
    const body = Buffer.from(markdown, 'utf8');
    const name = document.document_name || 'download';
    const encoded = encodeURIComponent(name);
    const ascii = name.replace(/[^\x00-\x7F]/g, '_');
    const headers = new Headers();
    headers.set('Content-Type', 'text/markdown; charset=utf-8');
    headers.set('Content-Disposition', `attachment; filename="${ascii}.md"; filename*=UTF-8''${encoded}.md`);
    headers.set('Content-Length', body.length.toString());
    headers.set('Cache-Control', 'no-cache');
    return new Response(body as any, { status: 200, headers });
  }

  const result = await StorageService.downloadFile(document.file_id);
  if (!result) {
    return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
  }
  return createDocumentDownloadResponse(result.buffer, result.metadata, document);
}
