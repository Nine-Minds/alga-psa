import { IDocument, PreviewResponse } from 'server/src/interfaces/document.interface';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import { StorageService } from 'server/src/lib/storage/StorageService';
import sharp from 'sharp';

/**
 * Handler for image documents
 */
export class ImageDocumentHandler extends BaseDocumentHandler {
  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    const docMimeType = document.mime_type?.toLowerCase();
    return !!docMimeType && docMimeType.startsWith('image/') && !!document.file_id;
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
      if (!document.file_id) {
        return {
          success: false,
          error: 'No file ID found for image document'
        };
      }

      // Check cache first
      const cachedPreview = await this.getFromCache(document.file_id, tenant);
      if (cachedPreview) {
        return cachedPreview;
      }

      // Download file from storage
      const downloadResult = await StorageService.downloadFile(document.file_id);
      if (!downloadResult) {
        throw new Error(`File not found in storage for ID: ${document.file_id}`);
      }

      const { buffer, metadata } = downloadResult;

      try {
        // Resize image and save to cache
        const imageBuffer = await sharp(buffer)
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .png({ quality: 80 })
          .toBuffer();
        
        await this.saveToCache(document.file_id, imageBuffer, tenant);
        
        // Convert to base64 for response
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        
        return { 
          success: true, 
          previewImage: base64Image, 
          content: `Image File (${metadata.original_name || 'image'})` 
        };
      } catch (imageError) {
        console.error('Image processing error:', imageError);
        return { success: false, error: 'Failed to process image file' };
      }
    } catch (error) {
      console.error(`[ImageDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate image document preview'
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
      if (!document.file_id) {
        return '<p>No file ID found for image document</p>';
      }

      // Get image URL
      const imageUrl = `/api/documents/download/${document.document_id}`;

      return `
        <div class="image-container">
          <img src="${imageUrl}" alt="${document.document_name || 'Image'}" style="max-width: 100%; height: auto;" />
          <div class="image-info">
            <p>Filename: ${document.document_name || 'Unknown'}</p>
            <p>Type: ${document.mime_type || 'Unknown'}</p>
            <p>Size: ${document.file_size ? Math.round(document.file_size / 1024) + ' KB' : 'Unknown'}</p>
          </div>
        </div>
      `;
    } catch (error) {
      console.error(`[ImageDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating document content</p>';
    }
  }
}