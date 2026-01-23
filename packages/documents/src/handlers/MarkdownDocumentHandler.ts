import type { IDocument, PreviewResponse } from '@alga-psa/types';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import { marked } from 'marked';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';

/**
 * Handler for Markdown documents
 */
export class MarkdownDocumentHandler extends BaseDocumentHandler {
  // Type names that this handler can process
  private static readonly MARKDOWN_TYPE_NAMES = ['markdown', 'markdown document', 'text/markdown'];

  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    const docTypeName = document.type_name?.toLowerCase();
    const docMimeType = document.mime_type?.toLowerCase();
    const docName = document.document_name?.toLowerCase();
    
    return (
      (MarkdownDocumentHandler.MARKDOWN_TYPE_NAMES.includes(docTypeName || '') || 
       docMimeType === 'text/markdown' || 
       docName?.endsWith('.md')) &&
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
          error: 'No content found for this markdown document'
        };
      }

      // Get a snippet of the markdown content and convert to HTML
      const markdownSnippet = docContent.content.substring(0, 1000);
      const htmlContent = await marked(markdownSnippet, { async: true });

      // Generate preview image
      const imageBuffer = await this.renderHtmlToPng(htmlContent);

      // Save to cache
      await this.saveToCache(document.document_id, imageBuffer, tenant);

      // Convert to base64 for response
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      return {
        success: true,
        previewImage: base64Image,
        content: "Markdown Document"
      };
    } catch (error) {
      console.error(`[MarkdownDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate markdown document preview'
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
        return '<p>No content found for this markdown document</p>';
      }

      // Convert markdown to HTML
      return await marked(docContent.content, { async: true });
    } catch (error) {
      console.error(`[MarkdownDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating document content</p>';
    }
  }
}
