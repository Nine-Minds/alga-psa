import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import DocumentBlockContent from 'server/src/lib/models/documentBlockContent';
import Document from '@alga-psa/documents/models/document';
import { marked } from 'marked';
import { convertBlockNoteToHTML } from 'server/src/lib/utils/blocknoteUtils';
import logger from '@alga-psa/core/logger';
import { downloadDocument } from '@alga-psa/documents/actions/documentActions';
import { createPDFGenerationService } from 'server/src/services/pdf-generation.service';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { getSession } from 'server/src/lib/auth/getSession';

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const resolvedParams = await params;
  const session = await getSession();
  // Session check is important for both PDF generation and direct download
  if (!session || !session.user || !session.user.tenant) {
    logger.warn(`Unauthorized attempt to download document/generate PDF for ID: ${resolvedParams.fileId}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // The URL parameter is named fileId but it's actually the document_id
  const documentId = resolvedParams.fileId;
  const format = req.nextUrl.searchParams.get('format');

  if (!documentId || typeof documentId !== 'string') {
     logger.error('Invalid document ID received for download/PDF generation.');
    return NextResponse.json({ error: 'Invalid document ID.' }, { status: 400 });
  }

  // --- PDF Generation Logic ---
  if (format === 'pdf') {
    logger.info(`PDF generation requested for document ID: ${documentId}`);
    
    try {
      // Get document to verify it exists and belongs to the user's tenant
      const { knex } = await createTenantKnex();
      const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await Document.get(trx, documentId);
      });
      
      if (!document || document.tenant !== session.user.tenant) {
        logger.warn(`Document not found or tenant mismatch for PDF generation. ID: ${documentId}, Tenant: ${session.user.tenant}`);
        return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
      }
      
      // Use the PDF generation service
      const pdfService = createPDFGenerationService(session.user.tenant);
      
      try {
        const fileRecord = await pdfService.generateAndStore({
          documentId: documentId,
          userId: session.user.id
        });
        
        // Download the generated PDF
        const result = await StorageService.downloadFile(fileRecord.file_id);
        if (!result) {
          logger.error(`Failed to download generated PDF for document ${documentId}`);
          return NextResponse.json({ error: 'Failed to download generated PDF.' }, { status: 500 });
        }
        
        // Return the PDF
        const headers = new Headers();
        headers.set('Content-Type', 'application/pdf');
        headers.set('Content-Disposition', `attachment; filename="${document.document_name || 'document'}.pdf"`);
        // PDFs can be cached since they're generated and stored
        headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        headers.set('ETag', `"${fileRecord.file_id}"`);
        
        return new Response(result.buffer as any, { status: 200, headers });
      } catch (pdfError) {
        logger.error(`Error generating PDF for document ${documentId}:`, pdfError);
        return NextResponse.json({ error: 'Failed to generate PDF.' }, { status: 500 });
      }

    } catch (error) {
      logger.error(`Error generating PDF for document ${documentId}:`, error);
      return NextResponse.json({ error: 'Failed to generate PDF.' }, { status: 500 });
    }
  } else {
    // --- Original File Download Logic ---
    logger.info(`Standard file download requested for document ID: ${documentId}`);
    try {
      // First, get the document to find its file_id
      const { knex } = await createTenantKnex();
      const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await Document.get(trx, documentId);
      });
      
      if (!document || document.tenant !== session.user.tenant) {
        logger.warn(`Document not found or tenant mismatch. ID: ${documentId}, Tenant: ${session.user.tenant}`);
        return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
      }
      
      // If document exists, use its file_id with downloadDocument
      if (!document.file_id) {
        logger.warn(`Document has no associated file. Document ID: ${documentId}`);
        return NextResponse.json({ error: 'Document has no associated file.' }, { status: 404 });
      }
      
      // Use the file_id from the document, not the document_id
      return await downloadDocument(document.file_id);
    } catch (error) {
      logger.error(`Error in standard download route for document ${documentId}:`, error);
      // Ensure a standard Response object is returned on error
      const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}

export const dynamic = 'force-dynamic';
