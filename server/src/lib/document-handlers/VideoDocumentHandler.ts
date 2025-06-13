import { IDocument, PreviewResponse } from 'server/src/interfaces/document.interface';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import path from 'path';

/**
 * Handler for video file types
 * Provides basic information without generating image previews
 */
export class VideoDocumentHandler extends BaseDocumentHandler {
  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    // Handle documents with video MIME types
    if (document.mime_type?.startsWith('video/')) {
      return true;
    }
    
    // Also handle based on file extension
    const extension = this.getFileExtension(document.document_name || '');
    const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'webm', 'ogg', 'm4v', '3gp', 'flv'];
    return videoExtensions.includes(extension.toLowerCase());
  }

  /**
   * Generates a preview for the video document
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
          error: 'No file ID found for document'
        };
      }

      // Check cache first
      const cachedPreview = await this.getFromCache(document.file_id, tenant);
      if (cachedPreview) {
        return cachedPreview;
      }

      // For videos, we don't generate a preview image
      // Instead, we return success without a preview image
      // The client-side video component will handle the preview
      const fileName = document.document_name || 'Unknown';
      const fileSize = document.file_size ? Math.round(Number(document.file_size) / 1024) + ' KB' : 'Unknown size';
      const mimeType = document.mime_type || 'Unknown';
      
      const content = `Video File: ${fileName} (${fileSize})`;
      
      const result = { 
        success: true, 
        content: content,
        // No previewImage - let the client handle video preview
      };
      
      // Cache the result (without image data)
      await this.saveToCache(document.file_id, Buffer.from(JSON.stringify(result)), tenant);
      
      return result;
    } catch (error) {
      console.error(`[VideoDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate video preview'
      };
    }
  }

  /**
   * Generates HTML content for the video document
   * @param document The document to generate HTML for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to an HTML string
   */
  async generateHTML(document: IDocument, tenant: string, knex: any): Promise<string> {
    try {
      const fileName = document.document_name || 'Unknown';
      const fileSize = document.file_size ? Math.round(Number(document.file_size) / 1024) + ' KB' : 'Unknown size';
      const mimeType = document.mime_type || 'Unknown';
      
      return `
        <div class="video-document-info">
          <h3>🎬 Video File</h3>
          <p><strong>Filename:</strong> ${fileName}</p>
          <p><strong>Type:</strong> ${mimeType}</p>
          <p><strong>Size:</strong> ${fileSize}</p>
          <div class="video-preview-note">
            <p>Video preview is handled by the client-side player.</p>
            <p><a href="/api/documents/view/${document.file_id}" target="_blank">View Video</a></p>
            <p><a href="/api/documents/download/${document.document_id}" target="_blank">Download Video</a></p>
          </div>
        </div>
      `;
    } catch (error) {
      console.error(`[VideoDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating video content</p>';
    }
  }

  /**
   * Gets the file extension from a filename
   * @param filename The filename
   * @returns The file extension (without the dot)
   */
  private getFileExtension(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return ext ? ext.substring(1) : '';
  }
}