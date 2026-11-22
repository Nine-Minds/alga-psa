/**
 * Background preview job: the name, payload and enqueue helper shared by every code path that
 * creates (or replaces the bytes of) a `documents` row. The handler lives in
 * `server/src/lib/jobs/handlers/generateDocumentPreviewsHandler.ts` and runs
 * `generatePreviewsForDocument(documentId)`, which reads the source from storage.
 *
 * Enqueued directly (not from the DOCUMENT_UPLOADED event): that event fires from StorageService
 * before any document row exists, so a subscriber would have nothing to load.
 */
import { getJobRunner } from '@alga-psa/core/jobRunnerAccessor';

export const GENERATE_DOCUMENT_PREVIEWS_JOB = 'generate-document-previews';

export interface GenerateDocumentPreviewsJobData extends Record<string, unknown> {
  tenantId: string;
  documentId: string;
}

/**
 * Schedule preview generation for a committed document. Never throws and never blocks on the
 * work itself: a missing/unavailable job runner must not fail an upload whose bytes are stored.
 * Call only after the document row has committed.
 */
export async function scheduleDocumentPreviews(
  tenant: string,
  documentId: string,
  userId?: string | null,
): Promise<boolean> {
  try {
    const runner = await getJobRunner();
    await runner.scheduleJob<GenerateDocumentPreviewsJobData>(
      GENERATE_DOCUMENT_PREVIEWS_JOB,
      { tenantId: tenant, documentId },
      userId ? { userId } : undefined,
    );
    return true;
  } catch (error) {
    console.error(`[scheduleDocumentPreviews] Could not schedule previews for document ${documentId}:`, error);
    return false;
  }
}
