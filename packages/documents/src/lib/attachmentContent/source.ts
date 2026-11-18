import { buildDocumentMarkdown } from '../documentMarkdownExport';
import type { AttachmentDocument, AttachmentSource } from './types';

export interface AttachmentSourceDeps {
  /**
   * Stored file bytes (the caller wires StorageService.downloadFile). Never `downloadTicketDocument`, which
   * 404s on documents without a file.
   */
  downloadFile(fileId: string): Promise<Buffer>;
  /** The document's in-app bodies, for documents without a file. */
  loadInAppBodies(documentId: string): Promise<{ blockData: unknown; textContent: string | null }>;
}

/**
 * Bind an AUTHORIZED document to its byte and in-app loaders. Authorization is the caller's job and has
 * already happened; this only knows how to fetch. In-app bodies go through the Markdown conversion the
 * Markdown export and the API-key download route already use.
 */
export function createAttachmentSource(document: AttachmentDocument, deps: AttachmentSourceDeps): AttachmentSource {
  return {
    document,
    loadBytes: async () => {
      if (!document.file_id) throw new Error('document has no stored file');
      return deps.downloadFile(document.file_id);
    },
    loadInAppMarkdown: async () => {
      const { blockData, textContent } = await deps.loadInAppBodies(document.document_id);
      return buildDocumentMarkdown(blockData, textContent);
    },
  };
}
