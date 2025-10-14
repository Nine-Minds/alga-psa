import { IDocument, PreviewResponse } from 'server/src/interfaces/document.interface';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { PDFDocument } from 'pdf-lib';
import { fromPath } from 'pdf2pic';
import sharp from 'sharp';
import { join } from 'path';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';

/**
 * Handler for PDF documents
 */
export class PDFDocumentHandler extends BaseDocumentHandler {
  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    const docMimeType = document.mime_type?.toLowerCase();
    return docMimeType === 'application/pdf' && !!document.file_id;
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
          error: 'No file ID found for PDF document'
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

      const { buffer } = downloadResult;

      try {
        // Load PDF document to get page count
        const pdfDoc = await PDFDocument.load(buffer);
        const pageCount = pdfDoc.getPages().length;

        // Set up temporary directory for PDF conversion
        // Use OS temp directory to work with any storage provider (local/S3/MinIO)
        const tempDir = join(tmpdir(), 'alga-pdf-previews');
        await mkdir(tempDir, { recursive: true }).catch(err => {
          if (err.code !== 'EEXIST') throw err;
        });
        
        const tempPdfPath = join(tempDir, `${document.file_id}.pdf`);

        try {
          // Write PDF to temporary file
          await writeFile(tempPdfPath, buffer);
          
          // Convert first page to image
          const options = { 
            density: 100, 
            saveFilename: `${document.file_id}_thumb`, 
            savePath: tempDir, 
            format: "png", 
            width: 600, 
            quality: 75, 
            useIMagick: true 
          };
          
          const convert = fromPath(tempPdfPath, options);
          const conversionResult = await convert(1);
          
          // Resize image and save to cache
          const imageBuffer = await sharp(conversionResult.path)
            .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
            .png({ quality: 80 })
            .toBuffer();
          
          await this.saveToCache(document.file_id, imageBuffer, tenant);
          
          // Clean up temporary files
          await Promise.all([
            unlink(tempPdfPath), 
            unlink(conversionResult.path!)
          ]).catch(e => console.error("Error cleaning up temp PDF files:", e));
          
          // Convert to base64 for response
          const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
          
          return { 
            success: true, 
            previewImage: base64Image, 
            pageCount, 
            content: `PDF Document\nPages: ${pageCount}` 
          };
        } catch (conversionError) {
          console.error('PDF conversion error:', conversionError);
          await unlink(tempPdfPath).catch(e => console.error("Error cleaning up temp PDF file on error:", e));
          
          return { 
            success: true, 
            pageCount, 
            content: `PDF Document\nPages: ${pageCount}\n\nPreview image generation failed.` 
          };
        }
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError);
        return { success: false, error: 'Failed to parse PDF document' };
      }
    } catch (error) {
      console.error(`[PDFDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate PDF document preview'
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
        return '<p>No file ID found for PDF document</p>';
      }

      // Download file from storage
      const downloadResult = await StorageService.downloadFile(document.file_id);
      if (!downloadResult) {
        throw new Error(`File not found in storage for ID: ${document.file_id}`);
      }

      // Load PDF document to get page count
      const pdfDoc = await PDFDocument.load(downloadResult.buffer);
      const pageCount = pdfDoc.getPages().length;

      return `
        <div class="pdf-info">
          <h3>PDF Document</h3>
          <p>Filename: ${document.document_name || 'Unknown'}</p>
          <p>Pages: ${pageCount}</p>
          <p>Size: ${document.file_size ? Math.round(document.file_size / 1024) + ' KB' : 'Unknown'}</p>
          <p><a href="/api/documents/download/${document.file_id}" target="_blank">Download PDF</a></p>
        </div>
      `;
    } catch (error) {
      console.error(`[PDFDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating document content</p>';
    }
  }
}