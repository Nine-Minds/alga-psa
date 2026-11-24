import type { IDocument, PreviewResponse } from '@alga-psa/types';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import { StorageService } from '@alga-psa/storage/StorageService';
import { documentPreviewErrorMessage } from './previewErrors';
import path from 'path';
import fs from 'fs/promises';
import type { RenderContent } from '../lib/renderHtmlToPng';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Handler for Microsoft Office documents (Word, Excel, PowerPoint)
 */
export class OfficeDocumentHandler extends BaseDocumentHandler {
  // Office document MIME types
  private static readonly OFFICE_MIME_TYPES = [
    // Word documents
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-word.document.macroEnabled.12', // .docm
    
    // Excel documents
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm
    
    // PowerPoint documents
    'application/vnd.ms-powerpoint', // .ppt
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12' // .pptm
  ];

  // File extensions for Office documents
  private static readonly OFFICE_EXTENSIONS = [
    '.doc', '.docx', '.docm', 
    '.xls', '.xlsx', '.xlsm', 
    '.ppt', '.pptx', '.pptm'
  ];

  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    const docMimeType = document.mime_type?.toLowerCase();
    const docName = document.document_name?.toLowerCase();
    
    const hasMimeType = !!docMimeType && OfficeDocumentHandler.OFFICE_MIME_TYPES.includes(docMimeType);
    const hasExtension = !!docName && OfficeDocumentHandler.OFFICE_EXTENSIONS.some(ext => docName.endsWith(ext));
    
    return (hasMimeType || hasExtension) && !!document.file_id;
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
          error: 'No file ID found for Office document'
        };
      }

      // Check cache first
      const cachedPreview = await this.getFromCache(document.file_id, tenant);
      if (cachedPreview) {
        return cachedPreview;
      }

      // Get document type based on extension or mime type
      const docType = this.getOfficeDocumentType(document);
      
      // Generate placeholder HTML based on document type
      const previewContent = this.generatePlaceholderHTML(document, docType);
      
      // Generate preview image
      const imageBuffer = await this.renderHtmlToPng(previewContent, 400, 300);
      
      // Save to cache
      await this.saveToCache(document.file_id, imageBuffer, tenant);
      
      // Convert to base64 for response
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      
      return { 
        success: true, 
        previewImage: base64Image, 
        content: `${docType} Document (${document.document_name || ''})` 
      };
    } catch (error) {
      console.error(`[OfficeDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: documentPreviewErrorMessage(error, 'Failed to generate Office document preview')
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
        return '<p>No file ID found for Office document</p>';
      }

      const docType = this.getOfficeDocumentType(document);
      
      return `
        <div class="office-document-info">
          <h3>${escapeHtml(docType)} Document</h3>
          <p>Filename: ${escapeHtml(document.document_name || 'Unknown')}</p>
          <p>Type: ${document.mime_type || 'Unknown'}</p>
          <p>Size: ${document.file_size ? Math.round(document.file_size / 1024) + ' KB' : 'Unknown'}</p>
          <p><a href="/api/documents/download/${document.file_id}" target="_blank">Download Document</a></p>
          <p class="note">Preview not available for this document type. Please download to view.</p>
        </div>
      `;
    } catch (error) {
      console.error(`[OfficeDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating document content</p>';
    }
  }

  /**
   * Determines the Office document type based on extension or MIME type
   * @param document The document to check
   * @returns The document type (Word, Excel, PowerPoint)
   */
  private getOfficeDocumentType(document: IDocument): 'Word' | 'Excel' | 'PowerPoint' | 'Office' {
    const docMimeType = document.mime_type?.toLowerCase();
    const docName = document.document_name?.toLowerCase();
    
    if (docMimeType?.includes('word') || docName?.endsWith('.doc') || docName?.endsWith('.docx') || docName?.endsWith('.docm')) {
      return 'Word';
    } else if (docMimeType?.includes('excel') || docName?.endsWith('.xls') || docName?.endsWith('.xlsx') || docName?.endsWith('.xlsm')) {
      return 'Excel';
    } else if (docMimeType?.includes('powerpoint') || docName?.endsWith('.ppt') || docName?.endsWith('.pptx') || docName?.endsWith('.pptm')) {
      return 'PowerPoint';
    }
    
    return 'Office';
  }

  /**
   * Generates placeholder HTML for Office documents
   * @param document The document
   * @param docType The document type (Word, Excel, PowerPoint)
   * @returns HTML content for the placeholder
   */
  private generatePlaceholderHTML(document: IDocument, docType: 'Word' | 'Excel' | 'PowerPoint' | 'Office'): RenderContent {
    const fileName = document.document_name || 'Unknown';
    const fileSize = document.file_size ? Math.round(document.file_size / 1024) + ' KB' : 'Unknown size';
    
    let icon = '📄'; // Default document icon
    
    switch (docType) {
      case 'Word':
        icon = '📝';
        break;
      case 'Excel':
        icon = '📊';
        break;
      case 'PowerPoint':
        icon = '📑';
        break;
    }
    
    return { kind: 'file-placeholder', fileName, fileType: `${docType} Document`, fileSize, icon };
  }
}
