import type { IDocument, PreviewResponse } from '@alga-psa/types';

/**
 * Interface for document type handlers using the Strategy pattern
 * Each handler is responsible for determining if it can handle a document type
 * and generating previews for that document type
 */
export interface DocumentTypeHandler {
  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean;

  /**
   * Generates a preview for the document
   * @param document The document to generate a preview for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to a PreviewResponse
   */
  generatePreview(document: IDocument, tenant: string, knex: any): Promise<PreviewResponse>;

  /**
   * Generates HTML content for the document
   * @param document The document to generate HTML for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to an HTML string
   */
  generateHTML(document: IDocument, tenant: string, knex: any): Promise<string>;
}
