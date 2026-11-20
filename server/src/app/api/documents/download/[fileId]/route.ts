import { coManagedWorkspaceDenial } from '@/lib/api/coManagedWorkspaceDenial';
import { canReadDocument } from '@alga-psa/documents/lib/documentPermissions';
import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import DocumentBlockContent from 'server/src/lib/models/documentBlockContent';
import { marked } from 'marked';
import { convertBlockContentToMarkdown } from '@alga-psa/formatting/blocknoteUtils';

import logger from '@alga-psa/core/logger';
import {
  getAuthorizedDocumentByFileId,
  getAuthorizedDocumentById,
} from '@alga-psa/documents/actions/documentActions';
import { createPDFGenerationService } from '@alga-psa/billing/services';
import { StorageService } from '@alga-psa/storage/StorageService';
import { tenantDb, withTransaction, runWithTenant } from '@alga-psa/db';
import { Knex } from 'knex';
import { resolveDocumentRoutePrincipal } from '@/lib/api/documentRoutePrincipal';
import { serveDocumentFile } from '@/lib/api/serveDocumentFile';
import { buildDocumentMarkdown } from '@alga-psa/documents/lib/documentMarkdownExport';

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const resolvedParams = await params;
  // Session or API-key (internal users only); the same principal gates the export and original-file branches.
  const principal = await resolveDocumentRoutePrincipal(req);
  if (principal.ok === false) {
    logger.warn(`Unauthorized attempt to download document/generate PDF for ID: ${resolvedParams.fileId}`);
    return principal.response;
  }

  // The URL parameter may be either a document_id or file_id
  const lookupId = resolvedParams.fileId;
  const format = req.nextUrl.searchParams.get('format');

  if (!lookupId || typeof lookupId !== 'string') {
     logger.error('Invalid document ID received for download/PDF generation.');
    return NextResponse.json({ error: 'Invalid document ID.' }, { status: 400 });
  }

  const tenant = principal.tenant;
  const currentUser = principal.user;

  const denial = await coManagedWorkspaceDenial(tenant);
  if (denial) return denial;

  // Wrap in runWithTenant to ensure tenant context persists across async boundaries
  return await runWithTenant(tenant, async () => {
    // Mirror downloadDocument()'s permission gate for every export format.
    if (!(await canReadDocument(currentUser, lookupId))) {
      logger.warn(`User ${currentUser.user_id} lacks document:read permission. ID: ${lookupId}, Tenant: ${tenant}`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // --- Markdown Export Logic ---
    if (format === 'markdown' || format === 'md') {
      logger.info(`Markdown export requested for document ID: ${lookupId}`);

      try {
        const { knex } = await createTenantKnex();
        const { document, blockRow, textRow } = await withTransaction(knex, async (trx: Knex.Transaction) => {
          const db = tenantDb(trx, tenant);
          // Authorize through the same path as downloadDocument() (tenant
          // scoping + relationship/client-visibility rules) before exporting.
          const doc =
            (await getAuthorizedDocumentById(trx, tenant, currentUser, lookupId)) ||
            (await getAuthorizedDocumentByFileId(trx, tenant, currentUser, lookupId));

          if (!doc) {
            return { document: null, blockRow: null, textRow: null };
          }

          const [block, text] = await Promise.all([
            db.table('document_block_content')
              .where({ document_id: doc.document_id })
              .select('block_data')
              .first<{ block_data: unknown }>(),
            db.table('document_content')
              .where({ document_id: doc.document_id })
              .select('content')
              .first<{ content: string | null }>(),
          ]);

          return { document: doc, blockRow: block, textRow: text };
        });

        if (!document) {
          logger.warn(`Document not found or access denied for markdown export. ID: ${lookupId}, Tenant: ${tenant}`);
          return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
        }

        let markdown: string | null = buildDocumentMarkdown(blockRow?.block_data, textRow?.content);

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
        // Get the document through the same authorization path used by
        // downloadDocument() (tenant scoping + relationship/client-visibility
        // rules) before generating the PDF.
        const { knex } = await createTenantKnex();
        const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
          const byDocumentId = await getAuthorizedDocumentById(trx, tenant, currentUser, lookupId);
          if (byDocumentId) return byDocumentId;
          return getAuthorizedDocumentByFileId(trx, tenant, currentUser, lookupId);
        });

        if (!document) {
          logger.warn(`Document not found or access denied for PDF generation. ID: ${lookupId}, Tenant: ${tenant}`);
          return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
        }

        // Use the PDF generation service
        const pdfService = createPDFGenerationService(tenant);

        try {
          const fileRecord = await pdfService.generateAndStore({
            documentId: document.document_id,
            userId: currentUser.user_id
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
        // Same kernel-backed gate as the export branches (lookup by document_id or file_id).
        const { knex } = await createTenantKnex();
        const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
          const byDocumentId = await getAuthorizedDocumentById(trx, tenant, currentUser, lookupId);
          if (byDocumentId) return byDocumentId;
          return getAuthorizedDocumentByFileId(trx, tenant, currentUser, lookupId);
        });

        if (!document) {
          logger.warn(`Document not found or access denied. ID: ${lookupId}, Tenant: ${tenant}`);
          return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
        }

        if (!document.file_id) {
          logger.warn(`Document has no associated file. Document ID: ${lookupId}`);
          return NextResponse.json({ error: 'Document has no associated file.' }, { status: 404 });
        }

        return await serveDocumentFile(document, { knex, tenant });
      } catch (error) {
        logger.error(`Error in standard download route for document ${lookupId}:`, error);
        return new Response(JSON.stringify({ error: 'Failed to download document.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  });
}

export const dynamic = 'force-dynamic';
