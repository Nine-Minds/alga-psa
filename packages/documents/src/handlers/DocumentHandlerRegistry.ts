import type { IDocument, PreviewResponse } from '@alga-psa/types';
import { DocumentTypeHandler } from './DocumentTypeHandler';
import { TextDocumentHandler } from './TextDocumentHandler';
import { MarkdownDocumentHandler } from './MarkdownDocumentHandler';
import { BlockNoteDocumentHandler } from './BlockNoteDocumentHandler';
import { PDFDocumentHandler } from './PDFDocumentHandler';
import { ImageDocumentHandler } from './ImageDocumentHandler';
import { OfficeDocumentHandler } from './OfficeDocumentHandler';
import { VideoDocumentHandler } from './VideoDocumentHandler';
import { GenericFileDocumentHandler } from './GenericFileDocumentHandler';

/**
 * Registry for document type handlers
 * Manages all document handlers and provides a way to get the appropriate handler for a document
 */
export class DocumentHandlerRegistry {
  private static instance: DocumentHandlerRegistry;
  private handlers: DocumentTypeHandler[] = [];

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    this.registerHandlers();
  }

  /**
   * Gets the singleton instance of the registry
   * @returns The singleton instance
   */
  public static getInstance(): DocumentHandlerRegistry {
    if (!DocumentHandlerRegistry.instance) {
      DocumentHandlerRegistry.instance = new DocumentHandlerRegistry();
    }
    return DocumentHandlerRegistry.instance;
  }

  /**
   * Registers all document handlers
   * The order is important - more specific handlers should be registered first
   */
  private registerHandlers(): void {
    // In-app document handlers
    this.handlers.push(new BlockNoteDocumentHandler());
    this.handlers.push(new MarkdownDocumentHandler());
    this.handlers.push(new TextDocumentHandler());
    
    // File-based document handlers
    this.handlers.push(new PDFDocumentHandler());
    this.handlers.push(new ImageDocumentHandler());
    this.handlers.push(new VideoDocumentHandler());
    this.handlers.push(new OfficeDocumentHandler());
    
    // Generic handler should be last as it's a fallback
    this.handlers.push(new GenericFileDocumentHandler());
  }

  /**
   * Gets the appropriate handler for a document
   * @param document The document to get a handler for
   * @returns The appropriate handler for the document
   */
  public getHandler(document: IDocument): DocumentTypeHandler {
    for (const handler of this.handlers) {
      if (handler.canHandle(document)) {
        return handler;
      }
    }
    
    // This should never happen as GenericFileDocumentHandler should handle any document
    throw new Error(`No handler found for document: ${document.document_id}`);
  }

  /**
   * Generates a preview for a document using the appropriate handler
   * @param document The document to generate a preview for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to a PreviewResponse
   */
  public async generatePreview(document: IDocument, tenant: string, knex: any): Promise<PreviewResponse> {
    try {
      const handler = this.getHandler(document);
      console.log(`[DocumentHandlerRegistry] Using handler ${handler.constructor.name} for document ${document.document_id}`);
      return await handler.generatePreview(document, tenant, knex);
    } catch (error) {
      console.error(`[DocumentHandlerRegistry] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate document preview'
      };
    }
  }

  /**
   * Generates HTML content for a document using the appropriate handler
   * @param document The document to generate HTML for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to an HTML string
   */
  public async generateHTML(document: IDocument, tenant: string, knex: any): Promise<string> {
    try {
      const handler = this.getHandler(document);
      console.log(`[DocumentHandlerRegistry] Using handler ${handler.constructor.name} for document ${document.document_id}`);
      return await handler.generateHTML(document, tenant, knex);
    } catch (error) {
      console.error(`[DocumentHandlerRegistry] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating document content</p>';
    }
  }
}
