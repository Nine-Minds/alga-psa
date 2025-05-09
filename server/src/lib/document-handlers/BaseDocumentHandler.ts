import { IDocument, PreviewResponse } from 'server/src/interfaces/document.interface';
import { DocumentTypeHandler } from './DocumentTypeHandler';
import { CacheFactory } from 'server/src/lib/cache/CacheFactory';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

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
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      const styledHtml = `
        <style>
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"; font-size: 14px; line-height: 1.4; padding: 15px; border: 1px solid #e0e0e0; box-sizing: border-box; overflow: hidden; height: ${height}px; background-color: #ffffff; }
          pre { white-space: pre-wrap; word-wrap: break-word; font-family: monospace; }
          h1, h2, h3, h4, h5, h6 { margin-top: 0; margin-bottom: 0.5em; }
          p { margin-top: 0; margin-bottom: 1em; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          ul, ol { padding-left: 20px; margin-top: 0; margin-bottom: 1em; }
          img { max-width: 100%; height: auto; }
          /* Basic styling for BlockNote generated HTML */
          .bn-editor table { width: 100%; border-collapse: collapse; }
          .bn-editor th, .bn-editor td { border: 1px solid #ddd; padding: 8px; }
        </style>
        <div>${htmlContent}</div>
      `;
      await page.setContent(styledHtml, { waitUntil: 'domcontentloaded' });
      const imageBuffer = await page.screenshot({ type: 'png' });
      
      return Buffer.from(imageBuffer);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}