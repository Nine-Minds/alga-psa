import type { IDocument, PreviewResponse } from '@alga-psa/types';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import { StorageService } from '@alga-psa/storage/StorageService';
import { documentPreviewErrorMessage } from './previewErrors';
import path from 'path';
import type { RenderContent } from '../lib/renderHtmlToPng';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Handler for generic file types that don't have specific handlers
 * This is a fallback handler for any file type not handled by other handlers
 */
export class GenericFileDocumentHandler extends BaseDocumentHandler {
  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    // This is a fallback handler, so it handles any document with a file_id
    // Specific handlers should be checked before this one
    return !!document.file_id;
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
          error: 'No file ID found for document'
        };
      }

      // Check cache first
      const cachedPreview = await this.getFromCache(document.file_id, tenant);
      if (cachedPreview) {
        return cachedPreview;
      }

      // Get file metadata
      const downloadResult = await StorageService.downloadFile(document.file_id);
      if (!downloadResult) {
        throw new Error(`File not found in storage for ID: ${document.file_id}`);
      }

      const { metadata } = downloadResult;
      const fileExtension = this.getFileExtension(document.document_name || metadata.original_name || '');
      const fileType = this.getFileTypeLabel(document.mime_type || metadata.mime_type, fileExtension);
      
      // Generate placeholder HTML
      const htmlContent = this.generatePlaceholderHTML(document, fileType, fileExtension);
      
      // Generate preview image
      const imageBuffer = await this.renderHtmlToPng(htmlContent, 400, 300);
      
      // Save to cache
      await this.saveToCache(document.file_id, imageBuffer, tenant);
      
      // Convert to base64 for response
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      
      return { 
        success: true, 
        previewImage: base64Image, 
        content: `${fileType} (${document.document_name || metadata.original_name || 'Unknown'})` 
      };
    } catch (error) {
      console.error(`[GenericFileDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: documentPreviewErrorMessage(error, 'Failed to generate document preview')
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
        return '<p>No file ID found for document</p>';
      }

      // Get file metadata
      const downloadResult = await StorageService.downloadFile(document.file_id);
      if (!downloadResult) {
        throw new Error(`File not found in storage for ID: ${document.file_id}`);
      }

      const { metadata } = downloadResult;
      const fileExtension = this.getFileExtension(document.document_name || metadata.original_name || '');
      const fileType = this.getFileTypeLabel(document.mime_type || metadata.mime_type, fileExtension);
      
      return `
        <div class="file-document-info">
          <h3>${escapeHtml(fileType)}</h3>
          <p>Filename: ${escapeHtml(document.document_name || metadata.original_name || 'Unknown')}</p>
          <p>Type: ${escapeHtml(document.mime_type || metadata.mime_type || 'Unknown')}</p>
          <p>Size: ${document.file_size ? Math.round(document.file_size / 1024) + ' KB' : 'Unknown'}</p>
          <p><a href="/api/documents/download/${escapeHtml(document.file_id)}" target="_blank">Download File</a></p>
          <p class="note">Preview not available for this file type. Please download to view.</p>
        </div>
      `;
    } catch (error) {
      console.error(`[GenericFileDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating document content</p>';
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

  /**
   * Gets a user-friendly label for the file type
   * @param mimeType The MIME type
   * @param extension The file extension
   * @returns A user-friendly label for the file type
   */
  private getFileTypeLabel(mimeType: string, extension: string): string {
    if (!mimeType && !extension) {
      return 'Unknown File';
    }

    // Check MIME type first
    if (mimeType) {
      const mimeParts = mimeType.split('/');
      if (mimeParts.length === 2) {
        const mainType = mimeParts[0];
        const subType = mimeParts[1];
        
        switch (mainType) {
          case 'application':
            if (subType.includes('zip') || subType.includes('compressed') || subType.includes('archive')) {
              return 'Archive File';
            } else if (subType.includes('json')) {
              return 'JSON File';
            } else if (subType.includes('xml')) {
              return 'XML File';
            } else if (subType.includes('javascript') || subType.includes('js')) {
              return 'JavaScript File';
            } else if (subType.includes('css')) {
              return 'CSS File';
            } else if (subType.includes('html')) {
              return 'HTML File';
            }
            break;
          case 'text':
            if (subType.includes('csv')) {
              return 'CSV File';
            } else if (subType.includes('html')) {
              return 'HTML File';
            } else if (subType.includes('css')) {
              return 'CSS File';
            } else if (subType.includes('javascript')) {
              return 'JavaScript File';
            } else if (subType.includes('xml')) {
              return 'XML File';
            }
            return 'Text File';
          case 'audio':
            return 'Audio File';
          case 'video':
            return 'Video File';
        }
      }
    }

    // Fall back to extension
    switch (extension) {
      case 'zip':
      case 'rar':
      case '7z':
      case 'tar':
      case 'gz':
        return 'Archive File';
      case 'json':
        return 'JSON File';
      case 'xml':
        return 'XML File';
      case 'js':
        return 'JavaScript File';
      case 'css':
        return 'CSS File';
      case 'html':
      case 'htm':
        return 'HTML File';
      case 'csv':
        return 'CSV File';
      case 'mp3':
      case 'wav':
      case 'ogg':
      case 'flac':
        return 'Audio File';
      case 'mp4':
      case 'avi':
      case 'mov':
      case 'wmv':
      case 'mkv':
        return 'Video File';
      default:
        return extension.toUpperCase() + ' File';
    }
  }

  /**
   * Generates placeholder HTML for generic files
   * @param document The document
   * @param fileType The file type label
   * @param fileExtension The file extension
   * @returns HTML content for the placeholder
   */
  private generatePlaceholderHTML(document: IDocument, fileType: string, fileExtension: string): RenderContent {
    const fileName = document.document_name || 'Unknown';
    const fileSize = document.file_size ? Math.round(document.file_size / 1024) + ' KB' : 'Unknown size';
    
    // Choose icon based on file type
    let icon = '📄'; // Default document icon
    
    if (fileType.includes('Archive')) {
      icon = '🗄️';
    } else if (fileType.includes('Audio')) {
      icon = '🎵';
    } else if (fileType.includes('Video')) {
      icon = '🎬';
    } else if (fileType.includes('JSON') || fileType.includes('XML') || fileType.includes('HTML') || fileType.includes('CSS') || fileType.includes('JavaScript')) {
      icon = '📝';
    }
    
    return { kind: 'file-placeholder', fileName, fileType, fileSize, icon };
  }
}
