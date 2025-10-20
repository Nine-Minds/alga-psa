import { IDocument, PreviewResponse } from 'server/src/interfaces/document.interface';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import { convertBlockNoteToHTML } from 'server/src/lib/utils/blocknoteUtils';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';

/**
 * Handler for BlockNote documents
 */
export class BlockNoteDocumentHandler extends BaseDocumentHandler {
  // Type names that this handler can process
  private static readonly BLOCKNOTE_TYPE_NAMES = [
    'blocknote', 
    'block note', 
    'blocknote document', 
    'application/vnd.blocknote+json'
  ];

  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    const docTypeName = document.type_name?.toLowerCase();
    const docMimeType = document.mime_type?.toLowerCase();

    // If type_name or mime_type match, it's a BlockNote document
    const typeMatch = (
      (BlockNoteDocumentHandler.BLOCKNOTE_TYPE_NAMES.includes(docTypeName || '') ||
       BlockNoteDocumentHandler.BLOCKNOTE_TYPE_NAMES.includes(docMimeType || '')) &&
      !document.file_id // In-app document (not a file)
    );

    // If no type information but it's an in-app document, we'll check for block content in generatePreview
    // Also handle any in-app document that's not explicitly text or markdown
    const hasNoTypeInfo = !document.type_id && !document.shared_type_id && !document.type_name && !document.mime_type;
    const hasCustomType = !!document.type_name && !BlockNoteDocumentHandler.BLOCKNOTE_TYPE_NAMES.includes(docTypeName || '');
    const potentialBlockNote = !document.file_id && (hasNoTypeInfo || hasCustomType);

    return typeMatch || potentialBlockNote;
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

      // Get document block content from database
      const blockContent = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('document_block_content')
          .where({ document_id: document.document_id, tenant })
          .first();
      });

      // If no block content found and this was a potential match, pass to next handler
      if (!blockContent || !blockContent.block_data) {
        return {
          success: false,
          error: 'No content found for this BlockNote document'
        };
      }

      // Convert BlockNote data to HTML
      const htmlContent = convertBlockNoteToHTML(blockContent.block_data);

      // Generate preview image
      const imageBuffer = await this.renderHtmlToPng(htmlContent);

      // Save to cache
      await this.saveToCache(document.document_id, imageBuffer, tenant);

      // Convert to base64 for response
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      return {
        success: true,
        previewImage: base64Image,
        content: "BlockNote Document"
      };
    } catch (error) {
      console.error(`[BlockNoteDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate BlockNote document preview'
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
      // Get document block content from database
      const blockContent = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('document_block_content')
          .where({ document_id: document.document_id, tenant })
          .first();
      });

      if (!blockContent || !blockContent.block_data) {
        return '<p>No content found for this BlockNote document</p>';
      }

      // Convert BlockNote data to HTML
      return convertBlockNoteToHTML(blockContent.block_data);
    } catch (error) {
      console.error(`[BlockNoteDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating document content</p>';
    }
  }
}