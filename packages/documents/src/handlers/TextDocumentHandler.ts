import type { IDocument, PreviewResponse } from '@alga-psa/types';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';

/**
 * Handler for plain text documents
 */
export class TextDocumentHandler extends BaseDocumentHandler {
  // Type names that this handler can process
  private static readonly TEXT_TYPE_NAMES = ['text', 'text document', 'plain text', 'text/plain'];

  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    const docTypeName = document.type_name?.toLowerCase();
    const docMimeType = document.mime_type?.toLowerCase();

    return (
      (TextDocumentHandler.TEXT_TYPE_NAMES.includes(docTypeName || '') ||
       docMimeType === 'text/plain') &&
      !document.file_id // In-app document (not a file)
    );
  }

  /**
   * Generates a preview for the document
   * @param document The document to generate a preview for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to a PreviewResponse
   */
  async generatePreview(document: IDocument, tenant: string, knex: any): Promise<PreviewResponse> {
    try {
      // Check cache first
      const cachedPreview = await this.getFromCache(document.document_id, tenant);
      if (cachedPreview) {
        return cachedPreview;
      }

      // Get document content from database
      const docContent = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('document_content')
          .where({ document_id: document.document_id, tenant })
          .first();
      });

      if (!docContent || !docContent.content) {
        return {
          success: false,
          error: 'No content found for this text document'
        };
      }

      // Get a snippet of the text content
      const textSnippet = docContent.content.substring(0, 500);
      const escapedTextContent = textSnippet
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const htmlContent = `<pre>${escapedTextContent}</pre>`;

      // Generate preview image
      const imageBuffer = await this.renderHtmlToPng(htmlContent);

      // Save to cache
      await this.saveToCache(document.document_id, imageBuffer, tenant);

      // Convert to base64 for response
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      return {
        success: true,
        previewImage: base64Image,
        content: "Text Document"
      };
    } catch (error) {
      console.error(`[TextDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate text document preview'
      };
    }
  }

  /**
   * Generates HTML content for the document
   * @param document The document to generate HTML for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to an HTML string
   */
  async generateHTML(document: IDocument, tenant: string, knex: any): Promise<string> {
    try {
      // Get document content from database
      const docContent = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('document_content')
          .where({ document_id: document.document_id, tenant })
          .first();
      });

      if (!docContent || !docContent.content) {
        return '<p>No content found for this text document</p>';
      }

      // Escape HTML characters
      const escapedContent = docContent.content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      return `<pre>${escapedContent}</pre>`;
    } catch (error) {
      console.error(`[TextDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating document content</p>';
    }
  }
}
