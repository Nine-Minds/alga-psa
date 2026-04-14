import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import DocumentBlockContent from 'server/src/lib/models/documentBlockContent';
import Document from '@alga-psa/documents/models/document';
import { marked } from 'marked';
import { convertBlockContentToMarkdown } from '@alga-psa/formatting/blocknoteUtils';

import logger from '@alga-psa/core/logger';
import { downloadDocument } from '@alga-psa/documents/actions/documentActions';
import { createPDFGenerationService } from '@alga-psa/billing/services';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { withTransaction, runWithTenant } from '@alga-psa/db';
import { Knex } from 'knex';
import { getSession } from '@alga-psa/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const resolvedParams = await params;
  const session = await getSession();
  // Session check is important for both PDF generation and direct download
  if (!session || !session.user || !session.user.tenant) {
    logger.warn(`Unauthorized attempt to download document/generate PDF for ID: ${resolvedParams.fileId}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // The URL parameter may be either a document_id or file_id
  const lookupId = resolvedParams.fileId;
  const format = req.nextUrl.searchParams.get('format');

  if (!lookupId || typeof lookupId !== 'string') {
     logger.error('Invalid document ID received for download/PDF generation.');
    return NextResponse.json({ error: 'Invalid document ID.' }, { status: 400 });
  }

  // Wrap in runWithTenant to ensure tenant context persists across async boundaries
  return await runWithTenant(session.user.tenant, async () => {
    // --- Markdown Export Logic ---
    if (format === 'markdown' || format === 'md') {
      logger.info(`Markdown export requested for document ID: ${lookupId}`);

      try {
        const { knex } = await createTenantKnex();
        const { document, blockRow, textRow } = await withTransaction(knex, async (trx: Knex.Transaction) => {
          const doc =
            (await Document.get(trx, lookupId)) ||
            (await trx('documents')
              .where({ file_id: lookupId, tenant: session.user.tenant })
              .first());

          if (!doc || doc.tenant !== session.user.tenant) {
            return { document: null, blockRow: null, textRow: null };
          }

          const [block, text] = await Promise.all([
            trx('document_block_content')
              .where({ document_id: doc.document_id, tenant: session.user.tenant })
              .select('block_data')
              .first<{ block_data: unknown }>(),
            trx('document_content')
              .where({ document_id: doc.document_id, tenant: session.user.tenant })
              .select('content')
              .first<{ content: string | null }>(),
          ]);

          return { document: doc, blockRow: block, textRow: text };
        });

        if (!document) {
          logger.warn(`Document not found or tenant mismatch for markdown export. ID: ${lookupId}, Tenant: ${session.user.tenant}`);
          return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
        }

        let markdown: string | null = null;

        if (blockRow?.block_data !== undefined && blockRow?.block_data !== null) {
          const converted = convertBlockContentToMarkdown(blockRow.block_data);
          if (typeof converted === 'string' && converted.trim().length > 0) {
            markdown = converted;
          }
        }

        if (!markdown && typeof textRow?.content === 'string' && textRow.content.trim().length > 0) {
          markdown = textRow.content;
        }

        // Fall back to the stored file for file-backed text documents (e.g. uploaded .txt/.md).
        if (!markdown && document.file_id) {
          const mime = (document.mime_type || document.type_name || '').toLowerCase();
          const looksTextual = mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml';
          if (looksTextual) {
            try {
              const fileResult = await StorageService.downloadFile(document.file_id);
              if (fileResult?.buffer) {
                markdown = fileResult.buffer.toString('utf-8');
              }
            } catch (fileError) {
              logger.warn(`Failed to read file content for markdown export. Document ID: ${lookupId}`, fileError);
            }
          }
        }

        if (!markdown) {
          logger.warn(`Document has no exportable content for markdown. Document ID: ${lookupId}`);
          return NextResponse.json({ error: 'Document has no content to export.' }, { status: 404 });
        }

        // Collapse whitespace-only lines and runs of blank lines left over by the
        // BlockNote → markdown converter (empty paragraphs → " \n\n").
        markdown = markdown
          .replace(/\r\n/g, '\n')
          .split('\n')
          .map((line) => (line.trim().length === 0 ? '' : line.replace(/[ \t]+$/, '')))
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim() + '\n';

        const safeName = (document.document_name || 'document').replace(/[\r\n"]/g, '_');
        const headers = new Headers();
        headers.set('Content-Type', 'text/markdown; charset=utf-8');
        headers.set(
          'Content-Disposition',
          `attachment; filename="${safeName}.md"; filename*=UTF-8''${encodeURIComponent(safeName)}.md`,
        );
        headers.set('Cache-Control', 'no-store');

        return new Response(markdown, { status: 200, headers });
      } catch (error) {
        logger.error(`Error exporting markdown for document ${lookupId}:`, error);
        return NextResponse.json({ error: 'Failed to export markdown.' }, { status: 500 });
      }
    }

    // --- PDF Generation Logic ---
    if (format === 'pdf') {
      logger.info(`PDF generation requested for document ID: ${lookupId}`);

      try {
        // Get document to verify it exists and belongs to the user's tenant
        const { knex } = await createTenantKnex();
        const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
          // Try by document_id first, then by file_id
          const doc = await Document.get(trx, lookupId);
          if (doc) return doc;
          return await trx('documents')
            .where({ file_id: lookupId, tenant: session.user.tenant })
            .first();
        });

        if (!document || document.tenant !== session.user.tenant) {
          logger.warn(`Document not found or tenant mismatch for PDF generation. ID: ${lookupId}, Tenant: ${session.user.tenant}`);
          return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
        }

        // Use the PDF generation service
        const pdfService = createPDFGenerationService(session.user.tenant!);

        try {
          const fileRecord = await pdfService.generateAndStore({
            documentId: document.document_id,
            userId: session.user.id
          });

          // Download the generated PDF
          const result = await StorageService.downloadFile(fileRecord.file_id);
          if (!result) {
            logger.error(`Failed to download generated PDF for document ${lookupId}`);
            return NextResponse.json({ error: 'Failed to download generated PDF.' }, { status: 500 });
          }

          // Return the PDF
          const headers = new Headers();
          headers.set('Content-Type', 'application/pdf');
          headers.set('Content-Disposition', `attachment; filename="${document.document_name || 'document'}.pdf"`);
          // No browser caching — document content may change between exports
          headers.set('Cache-Control', 'no-store');

          return new Response(result.buffer as any, { status: 200, headers });
        } catch (pdfError) {
          logger.error(`Error generating PDF for document ${lookupId}:`, pdfError);
          return NextResponse.json({ error: 'Failed to generate PDF.' }, { status: 500 });
        }

      } catch (error) {
        logger.error(`Error generating PDF for document ${lookupId}:`, error);
        return NextResponse.json({ error: 'Failed to generate PDF.' }, { status: 500 });
      }
    } else {
      // --- Original File Download Logic ---
      logger.info(`Standard file download requested for document ID: ${lookupId}`);
      try {
        // First, get the document to find its file_id (lookup by document_id or file_id)
        const { knex } = await createTenantKnex();
        const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
          const doc = await Document.get(trx, lookupId);
          if (doc) return doc;
          return await trx('documents')
            .where({ file_id: lookupId, tenant: session.user.tenant })
            .first();
        });

        if (!document || document.tenant !== session.user.tenant) {
          logger.warn(`Document not found or tenant mismatch. ID: ${lookupId}, Tenant: ${session.user.tenant}`);
          return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
        }

        // If document exists, use its file_id with downloadDocument
        if (!document.file_id) {
          logger.warn(`Document has no associated file. Document ID: ${lookupId}`);
          return NextResponse.json({ error: 'Document has no associated file.' }, { status: 404 });
        }

        // Use the file_id from the document, not the document_id
        return await downloadDocument(document.file_id);
      } catch (error) {
        logger.error(`Error in standard download route for document ${lookupId}:`, error);
        // Ensure a standard Response object is returned on error
        const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  });
}

export const dynamic = 'force-dynamic';
