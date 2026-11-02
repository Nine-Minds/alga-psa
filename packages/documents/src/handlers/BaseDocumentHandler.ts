import type { IDocument, PreviewResponse } from '@alga-psa/types';
import { DocumentTypeHandler } from './DocumentTypeHandler';
import { CacheFactory } from '../cache/CacheFactory';
import { renderHtmlToPng } from '../lib/renderHtmlToPng';

async function loadSharp() {
  try {
    const mod = await import('sharp');
    return (mod as any).default ?? (mod as any);
  } catch (error) {
    throw new Error(
      `Failed to load optional dependency "sharp" (required for document previews). ` +
        `Ensure platform-specific sharp binaries are installed. Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Base class for document handlers that implements common functionality
 */
export abstract class BaseDocumentHandler implements DocumentTypeHandler {
  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  abstract canHandle(document: IDocument): boolean;

  /**
   * Generates a preview for the document
   * @param document The document to generate a preview for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to a PreviewResponse
   */
  abstract generatePreview(document: IDocument, tenant: string, knex: any): Promise<PreviewResponse>;

  /**
   * Generates HTML content for the document
   * @param document The document to generate HTML for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to an HTML string
   */
  abstract generateHTML(document: IDocument, tenant: string, knex: any): Promise<string>;

  /**
   * Checks if a preview is cached and returns it if available
   * @param identifier The identifier to check in the cache
   * @param tenant The tenant ID
   * @returns A promise that resolves to a PreviewResponse if cached, null otherwise
   */
  protected async getFromCache(identifier: string, tenant: string): Promise<PreviewResponse | null> {
    const cache = CacheFactory.getPreviewCache(tenant);
    const cachedPreview = await cache.get(identifier);
    
    if (cachedPreview) {
      console.log(`[DocumentHandler] Cache hit for identifier: ${identifier}`);
      const sharp = await loadSharp();
      const imageBuffer = await sharp(cachedPreview).toBuffer();
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      return {
        success: true,
        previewImage: base64Image,
        content: 'Cached Preview'
      };
    }
    
    return null;
  }

  /**
   * Saves a preview to the cache
   * @param identifier The identifier to use as the cache key
   * @param imageBuffer The image buffer to cache
   * @param tenant The tenant ID
   */
  protected async saveToCache(identifier: string, imageBuffer: Buffer, tenant: string): Promise<void> {
    const cache = CacheFactory.getPreviewCache(tenant);
    await cache.set(identifier, imageBuffer);
  }

  /**
   * Renders HTML content to a PNG image
   * @param htmlContent The HTML content to render
   * @param width The width of the image
   * @param height The height of the image
   * @returns A promise that resolves to a Buffer containing the PNG image
   */
  protected async renderHtmlToPng(htmlContent: string, width: number = 400, height: number = 300): Promise<Buffer> {
    // Single shared renderer: network is closed, remote images are inlined via safeFetch.
    return renderHtmlToPng(htmlContent, { width, height });
  }
}
