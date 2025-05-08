import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { options } from 'server/src/app/api/auth/[...nextauth]/options';
import { createTenantKnex } from 'server/src/lib/db';
import DocumentBlockContent from 'server/src/lib/models/documentBlockContent';
import Document from 'server/src/lib/models/document';
import puppeteer from 'puppeteer';
import { marked } from 'marked';
import { convertBlockNoteToHTML } from 'server/src/lib/utils/blocknoteUtils';
import logger from '@shared/core/logger';
import { downloadDocument } from 'server/src/lib/actions/document-actions/documentActions';

export async function GET(req: NextRequest, { params }: { params: { fileId: string } }) {
  const session = await getServerSession(options);
  // Session check is important for both PDF generation and direct download
  if (!session || !session.user || !session.user.tenant) {
    logger.warn(`Unauthorized attempt to download document/generate PDF for ID: ${params.fileId}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fileId } = params;
  const format = req.nextUrl.searchParams.get('format');

  if (!fileId || typeof fileId !== 'string') {
     logger.error('Invalid file ID received for download/PDF generation.');
    return NextResponse.json({ error: 'Invalid file ID.' }, { status: 400 });
  }

  // --- PDF Generation Logic ---
  if (format === 'pdf') {
    logger.info(`PDF generation requested for document ID: ${fileId}`);
    const { knex } = await createTenantKnex(); // Knex needed only for PDF generation path

    try {
      const document = await Document.get(fileId);

      if (!document || document.tenant !== session.user.tenant) {
        logger.warn(`Document not found or tenant mismatch for PDF generation. ID: ${fileId}, Tenant: ${session.user.tenant}`);
        return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
      }

      let htmlContent = '';
      let rawContent = '';

      // Determine document type and generate HTML
      if (document.type_name === 'text/plain' || document.type_name === 'text/markdown') {
        const docWithContent = document as any;
        if (!docWithContent.content || typeof docWithContent.content !== 'string') {
          logger.error(`Document content not found or invalid for text/markdown PDF. ID: ${fileId}`);
          return NextResponse.json({ error: 'Document content not found or invalid.' }, { status: 404 });
        }
        rawContent = docWithContent.content;
        if (document.type_name === 'text/markdown') {
          htmlContent = await marked(rawContent);
        } else {
          const escapedText = rawContent.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
          htmlContent = `<pre>${escapedText}</pre>`;
        }
        logger.info(`Generated HTML for text/markdown document PDF: ${fileId}`);
      } else if (!document.type_name && !document.file_id) {
        // Assumed BlockNote
        logger.info(`Processing as BlockNote document for PDF: ${fileId}`);
        const docWithBlockContent = await DocumentBlockContent.getWithDocument(fileId);
        if (!docWithBlockContent || !docWithBlockContent.blockContent || !docWithBlockContent.blockContent.block_data) {
          logger.error(`BlockNote content not found for PDF generation. ID: ${fileId}`);
          return NextResponse.json({ error: 'BlockNote content not found.' }, { status: 404 });
        }
        htmlContent = convertBlockNoteToHTML(docWithBlockContent.blockContent.block_data);
        logger.info(`Generated HTML for BlockNote document PDF: ${fileId}`);
      } else {
        logger.warn(`Unsupported document type for PDF generation requested. Type: ${document.type_name || 'Unknown'}, ID: ${fileId}`);
        return NextResponse.json({ error: 'This document type cannot be downloaded as PDF.' }, { status: 400 });
      }

      // PDF Generation with Puppeteer
      logger.info(`Launching Puppeteer for PDF generation: ${fileId}`);
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();

      const fullHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>${document.document_name || 'Document'}</title>
            <style>
              body { font-family: sans-serif; margin: 20px; font-size: 12px; }
              pre { white-space: pre-wrap; word-wrap: break-word; font-family: monospace; }
              h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
              ul, ol { margin-top: 0.5em; margin-bottom: 0.5em; padding-left: 1.5em; }
              table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f2f2f2; }
              code { font-family: monospace; background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px;}
              pre code { display: block; padding: 0.5em; background-color: #f0f0f0; border-radius: 3px; }
              blockquote { border-left: 3px solid #ccc; padding-left: 1em; margin-left: 0; font-style: italic; }
            </style>
          </head>
          <body>
            ${htmlContent}
          </body>
        </html>
      `;

      await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
      await browser.close();
      logger.info(`Successfully generated PDF for document: ${fileId}`);

      const headers = new Headers();
      headers.set('Content-Type', 'application/pdf');
      headers.set('Content-Disposition', `attachment; filename="${document.document_name || 'document'}.pdf"`);

      return new NextResponse(pdfBuffer, { status: 200, headers });

    } catch (error) {
      logger.error(`Error generating PDF for document ${fileId}:`, error);
      return NextResponse.json({ error: 'Failed to generate PDF.' }, { status: 500 });
    }
  } else {
    // --- Original File Download Logic ---
    logger.info(`Standard file download requested for ID: ${fileId}`);
    try {
      // Assuming downloadDocument handles authentication/authorization internally
      // or relies on middleware. If not, session check might be needed here too.
      return await downloadDocument(fileId);
    } catch (error) {
      logger.error(`Error in standard download route for file ${fileId}:`, error);
      // Ensure a standard Response object is returned on error
      const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
      return new Response(JSON.stringify({ error: errorMessage }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  }
}
