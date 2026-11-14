import type { IDocument } from '@alga-psa/types';

/** How long after a save a missing preview is still assumed to be coming from the background job. */
export const PREVIEW_POLL_WINDOW_MS = 10 * 60 * 1000;

/**
 * A recently saved image/PDF/video whose background preview has not landed yet.
 * The generator writes thumbnail_file_id, preview_file_id and preview_generated_at in one update,
 * so "awaiting" ends for both the list polling and the card at the same moment.
 */
export function isAwaitingPreview(
  doc: Pick<IDocument, 'mime_type' | 'file_id' | 'thumbnail_file_id' | 'preview_file_id' | 'preview_generated_at' | 'updated_at' | 'entered_at'>,
  now: number = Date.now()
): boolean {
  const mime = doc.mime_type?.toLowerCase() ?? '';
  if (!(mime.startsWith('image/') || mime.startsWith('video/') || mime === 'application/pdf')) return false;
  if (!doc.file_id || doc.thumbnail_file_id || doc.preview_file_id || doc.preview_generated_at) return false;
  const changedAt = new Date((doc.updated_at ?? doc.entered_at) as Date).getTime();
  return Number.isFinite(changedAt) && now - changedAt < PREVIEW_POLL_WINDOW_MS;
}
