import logger from '@alga-psa/core/logger';
import { runWithTenant } from '@alga-psa/db';
import { generatePreviewsForDocument } from '@alga-psa/documents/lib/documentPreviewGenerator';
import type { GenerateDocumentPreviewsJobData } from '@alga-psa/documents/lib/documentPreviewJob';

/**
 * Generate the thumbnail and preview for one document from its stored file.
 * Idempotent and retry-safe (see generatePreviewsForDocument): failures rethrow so the runner
 * retries, and a re-run updates the same document row rather than adding derivatives.
 */
export async function generateDocumentPreviewsHandler(data: GenerateDocumentPreviewsJobData): Promise<void> {
  const { tenantId, documentId } = data;
  if (!tenantId || !documentId) {
    throw new Error('generate-document-previews requires tenantId and documentId');
  }

  await runWithTenant(tenantId, async () => {
    const result = await generatePreviewsForDocument(documentId);
    logger.info('[DocumentPreviews] Generated previews', {
      tenantId,
      documentId,
      thumbnail: Boolean(result.thumbnail_file_id),
      preview: Boolean(result.preview_file_id),
    });
  });
}
