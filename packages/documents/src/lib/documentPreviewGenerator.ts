/**
 * Document Preview Generator
 *
 * Generates thumbnails and previews for a document from its stored file. Runs in the background
 * (`generate-document-previews` job, see documentPreviewJob.ts); it never receives file bytes from
 * a caller and never loads a whole source file into memory.
 *
 * Preview Sizes:
 * - Thumbnail: 200x200 (cover fit) - for list views and cards
 * - Preview: 800x600 (inside fit) - for preview modal/drawer
 *
 * Supported File Types and how the source is read:
 * - Images (image/*): storage read stream piped into sharp (one decode, two outputs via clone()).
 * - PDFs (application/pdf): streamed to a temp file (pdf2pic/Ghostscript need a path), capped at
 *   MAX_PDF_PREVIEW_BYTES. Larger PDFs get no preview (placeholder), not a failure.
 * - Videos (video/*): ffmpeg opens a seekable input directly (local file path, or an internal
 *   presigned URL for S3/MinIO) and grabs one frame with -ss; the video never enters this process.
 * - Other types: no previews (UI shows type icons).
 *
 * Idempotent: re-running for a document leaves exactly one thumbnail and one preview derivative
 * (see persistPreviewResult).
 */

import { fromPath } from 'pdf2pic';
import type { Knex } from 'knex';
import { StorageService } from '@alga-psa/storage/StorageService';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withFileUploadTransaction } from '@alga-psa/storage/fileUploadTransaction';
import type { IDocument } from '@alga-psa/types';
import { validateDocumentPreviewProvenance } from './documentPreviewProvenance';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { isValidUUID } from '@alga-psa/validation';
import { v4 as uuidv4 } from 'uuid';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import {
  buildMediaProcessingFailedPayload,
  buildMediaProcessingSucceededPayload,
} from '@alga-psa/workflow-streams';

const execFileAsync = promisify(execFile);

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
 * Preview size configuration
 */
const PREVIEW_SIZES = {
  thumbnail: { width: 200, height: 200, fit: 'cover' as const },
  preview: { width: 800, height: 600, fit: 'inside' as const },
};

/**
 * JPEG quality settings for generated previews
 */
const QUALITY_SETTINGS = {
  thumbnail: 80,
  preview: 85,
};

/**
 * PDF size cap. pdf2pic/Ghostscript only accept a file path, so the PDF is streamed to a temp file
 * (disk, not process memory) first. Beyond this size the document gets no preview.
 * Override with DOCUMENT_PREVIEW_MAX_PDF_BYTES.
 */
export const MAX_PDF_PREVIEW_BYTES = (() => {
  const configured = Number(process.env.DOCUMENT_PREVIEW_MAX_PDF_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 100 * 1024 * 1024;
})();

/** Lifetime of the presigned URL handed to ffmpeg; must outlast the frame extraction. */
const SEEKABLE_URL_TTL_SECONDS = 900;
const FFMPEG_TIMEOUT_MS = 120_000;

/**
 * Upper bound on one pdf2pic/Ghostscript page render. A hung Ghostscript would otherwise block the
 * serial job consumer forever. Override with DOCUMENT_PREVIEW_PDF_RENDER_TIMEOUT_MS.
 */
export const PDF_RENDER_TIMEOUT_MS = (() => {
  const configured = Number(process.env.DOCUMENT_PREVIEW_PDF_RENDER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 120_000;
})();

/**
 * Result from preview generation
 */
export interface PreviewGenerationResult {
  thumbnail_file_id: string | null;
  preview_file_id: string | null;
  preview_generated_at: Date;
}

/** Deliberate, non-error outcome: nothing to generate (e.g. PDF over the cap). */
class PreviewSkipped extends Error {}

const emptyResult = (): PreviewGenerationResult => ({
  thumbnail_file_id: null,
  preview_file_id: null,
  preview_generated_at: new Date(),
});

type SourceKind = 'image' | 'pdf' | 'video';

function sourceKindOf(mimeType: string | null | undefined): SourceKind | null {
  const mime = mimeType?.toLowerCase() || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

/**
 * Generates (or regenerates) the thumbnail and preview for one document, reading the source from
 * storage, and writes them to the document row. Tenant-scoped through the ambient tenant context
 * (createTenantKnex), so callers run it inside the tenant's context.
 *
 * Throws on failure after publishing MEDIA_PROCESSING_FAILED, so the job runner can retry.
 * Returns empty ids (and publishes nothing) for documents with no file or an unsupported type.
 */
export async function generatePreviewsForDocument(documentId: string): Promise<PreviewGenerationResult> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }
  const db = tenantDb(knex, tenant);

  const document = await db.table<IDocument>('documents').where({ document_id: documentId }).first();
  if (!document) {
    console.warn(`[generatePreviewsForDocument] Document not found: ${documentId}`);
    return emptyResult();
  }
  if (!document.file_id) {
    return emptyResult();
  }

  const file = await db
    .table('external_files')
    .where({ file_id: document.file_id, is_deleted: false })
    .first('file_id', 'mime_type', 'file_size');
  const kind = sourceKindOf(document.mime_type ?? file?.mime_type);
  if (!kind) {
    console.log(`[generatePreviewsForDocument] Unsupported file type: ${document.mime_type}`);
    return emptyResult();
  }

  const startedAtMs = Date.now();
  try {
    if (!file) {
      throw new Error(`Source file ${document.file_id} not found for document ${documentId}`);
    }

    // Derivative writes are owned by an upload session: whatever this run writes but the document
    // does not end up referencing (a write that failed after the provider stored it, a superseded
    // run, a crash before commit) is reclaimed by upload recovery instead of leaking in storage.
    let outcome: { result: PreviewGenerationResult; superseded: boolean };
    try {
      outcome = await withFileUploadTransaction(knex, tenant, async (trx) => {
        const produced =
          kind === 'image'
            ? await generateImagePreviews(tenant, document)
            : kind === 'pdf'
              ? await generatePdfPreviews(tenant, document, Number(file.file_size))
              : await generateVideoPreviews(tenant, document);
        const persisted = await persistPreviewResult(trx, tenant, document, produced);
        const retained = persisted.superseded
          ? []
          : [persisted.result.thumbnail_file_id, persisted.result.preview_file_id].filter(
              (id): id is string => Boolean(id),
            );
        return { value: persisted, fileIds: retained };
      });
    } catch (error) {
      if (error instanceof PreviewSkipped) {
        console.warn(`[generatePreviewsForDocument] ${error.message} (document ${documentId})`);
        return emptyResult();
      }
      throw error;
    }
    if (!outcome.superseded) {
      await publishProcessingSucceeded({ tenant, document, result: outcome.result, startedAtMs });
    }
    return outcome.result;
  } catch (error) {
    console.error(`[generatePreviewsForDocument] Error generating previews for document ${documentId}:`, error);
    await publishProcessingFailed({ tenant, document, error, startedAtMs });
    throw error;
  }
}

/**
 * Write the derivative ids to the document row and remove superseded derivatives, atomically
 * under a row lock. This is what makes a retried (or concurrent) job leave exactly one thumbnail
 * and one preview: every derivative of this document that is not the final one is deleted.
 *
 * // LEVERAGE: friction storage-replace-object — StorageService can neither overwrite a file in place nor
 * // upload from a stream without buffering, so "reuse the preview row" is implemented as upload-new then delete-the-rest.
 *
 * - A kind that failed this run keeps its existing derivative (same source file, still valid).
 * - If the document's file changed while we worked (replaceDocumentFile), our output is for the
 *   wrong bytes: discard it and let the job enqueued for the new file win.
 */
async function persistPreviewResult(
  trx: Knex.Transaction,
  tenant: string,
  document: IDocument,
  produced: { thumbnail_file_id: string | null; preview_file_id: string | null },
): Promise<{ result: PreviewGenerationResult; superseded: boolean }> {
  const actor = document.created_by ?? document.user_id ?? '';

  const db = tenantDb(trx, tenant);
  const current = await db
    .table<IDocument>('documents')
    .where({ document_id: document.document_id })
    .forUpdate()
    .first();

  const newIds = [produced.thumbnail_file_id, produced.preview_file_id].filter((id): id is string => Boolean(id));
  const discard = async (ids: string[]) => {
    for (const id of ids) {
      try {
        await StorageService.deleteFile(id, actor, trx);
      } catch (error) {
        console.error(`[persistPreviewResult] Could not delete derivative ${id}:`, error);
      }
    }
  };

  if (!current || current.file_id !== document.file_id) {
    await discard(newIds);
    return { result: emptyResult(), superseded: true };
  }

  // A concurrent run may already have removed a derivative we just uploaded.
  const live = new Set<string>(
    newIds.length
      ? (await db.table('external_files').where({ is_deleted: false }).whereIn('file_id', newIds).select('file_id')).map(
          (row: { file_id: string }) => row.file_id,
        )
      : [],
  );
  const liveOrNull = (id: string | null) => (id && live.has(id) ? id : null);
  const result: PreviewGenerationResult = {
    thumbnail_file_id: liveOrNull(produced.thumbnail_file_id) ?? current.thumbnail_file_id ?? null,
    preview_file_id: liveOrNull(produced.preview_file_id) ?? current.preview_file_id ?? null,
    preview_generated_at: new Date(),
  };

  await validateDocumentPreviewProvenance(trx, tenant, document.document_id, result);
  await db
    .table('documents')
    .where({ document_id: document.document_id })
    .update({
      thumbnail_file_id: result.thumbnail_file_id,
      preview_file_id: result.preview_file_id,
      preview_generated_at: result.preview_generated_at,
      updated_at: new Date(),
    });

  const keep = new Set([result.thumbnail_file_id, result.preview_file_id]);
  const derivatives: Array<{ file_id: string }> = await db
    .table('external_files')
    .where({ is_deleted: false })
    .whereRaw("metadata->>'source_document_id' = ?", [document.document_id])
    .whereRaw("metadata->>'context' in ('document_thumbnail', 'document_preview')")
    .select('file_id');
  await discard(derivatives.map((row) => row.file_id).filter((id) => !keep.has(id)));

  return { result, superseded: false };
}

/** Background job: there is no acting user. */
const SYSTEM_ACTOR = { actorType: 'SYSTEM' as const };

async function publishProcessingSucceeded(params: {
  tenant: string;
  document: IDocument;
  result: PreviewGenerationResult;
  startedAtMs: number;
}): Promise<void> {
  const fileId = typeof params.document.file_id === 'string' ? params.document.file_id : undefined;
  if (!fileId || !isValidUUID(fileId)) {
    return;
  }

  const occurredAt = new Date().toISOString();
  const outputs: unknown[] = [];
  if (params.result.thumbnail_file_id) {
    outputs.push({ type: 'thumbnail', fileId: params.result.thumbnail_file_id });
  }
  if (params.result.preview_file_id) {
    outputs.push({ type: 'preview', fileId: params.result.preview_file_id });
  }

  try {
    await publishWorkflowEvent({
      eventType: 'MEDIA_PROCESSING_SUCCEEDED',
      payload: buildMediaProcessingSucceededPayload({
        fileId,
        processedAt: occurredAt,
        durationMs: Math.max(0, Date.now() - params.startedAtMs),
        outputs: outputs.length > 0 ? outputs : undefined,
      }),
      ctx: { tenantId: params.tenant, occurredAt, actor: SYSTEM_ACTOR },
      idempotencyKey: `media_processing_succeeded:document_previews:${fileId}:${occurredAt}`,
    });
  } catch (eventError) {
    console.error('[generatePreviewsForDocument] Failed to publish MEDIA_PROCESSING_SUCCEEDED workflow event', eventError);
  }
}

async function publishProcessingFailed(params: {
  tenant: string;
  document: IDocument;
  error: unknown;
  startedAtMs: number;
}): Promise<void> {
  const fileId = typeof params.document.file_id === 'string' ? params.document.file_id : undefined;
  if (!fileId || !isValidUUID(fileId)) {
    return;
  }

  const occurredAt = new Date().toISOString();
  const errorMessage = params.error instanceof Error ? params.error.message : String(params.error);

  try {
    await publishWorkflowEvent({
      eventType: 'MEDIA_PROCESSING_FAILED',
      payload: buildMediaProcessingFailedPayload({
        fileId,
        failedAt: occurredAt,
        errorCode: 'DOCUMENT_PREVIEW_GENERATION_FAILED',
        errorMessage,
        retryable: true,
      }),
      ctx: { tenantId: params.tenant, occurredAt, actor: SYSTEM_ACTOR },
      idempotencyKey: `media_processing_failed:document_previews:${fileId}:${occurredAt}`,
    });
  } catch (eventError) {
    console.error('[generatePreviewsForDocument] Failed to publish MEDIA_PROCESSING_FAILED workflow event', eventError);
  }
}

/**
 * Encode the two JPEG derivatives from one decoded source (a storage stream or a small rendered
 * frame) and store them. Each derivative fails independently; both failing is an error.
 * Derivatives are always re-encoded JPEGs, never an alias of the original (which may be active
 * content such as SVG).
 */
async function storeDerivatives(
  tenant: string,
  document: IDocument,
  source: Readable | Buffer,
  extraMetadata: Record<string, unknown> = {},
): Promise<{ thumbnail_file_id: string | null; preview_file_id: string | null }> {
  const sharp = await loadSharp();

  // One sharp pipeline fed by the source, cloned per output: a stream is decoded once and is
  // never collected into a buffer.
  const base = Buffer.isBuffer(source) ? sharp(source) : sharp();
  if (!Buffer.isBuffer(source)) {
    source.on('error', (error) => base.destroy(error));
    source.pipe(base);
  }

  const encode = (kind: 'thumbnail' | 'preview') =>
    base
      .clone()
      .resize(PREVIEW_SIZES[kind].width, PREVIEW_SIZES[kind].height, {
        fit: PREVIEW_SIZES[kind].fit,
        // Thumbnails are always produced at full size; previews are never enlarged.
        withoutEnlargement: kind === 'preview',
      })
      .jpeg({ quality: QUALITY_SETTINGS[kind] })
      .toBuffer();

  const [thumbnail, preview] = await Promise.allSettled([encode('thumbnail'), encode('preview')]);

  const store = async (kind: 'thumbnail' | 'preview', encoded: PromiseSettledResult<Buffer>) => {
    if (encoded.status === 'rejected') {
      console.error(`[storeDerivatives] ${kind} generation failed:`, encoded.reason);
      return null;
    }
    try {
      const uploaded = await StorageService.uploadFile(tenant, encoded.value, `${document.document_id}_${kind}.jpg`, {
        mime_type: 'image/jpeg',
        uploaded_by_id: document.created_by,
        origin: 'system-artifact',
        // Derived artifacts are not first-class documents: don't re-trigger DOCUMENT_UPLOADED.
        isDerivedArtifact: true,
        metadata: {
          context: kind === 'thumbnail' ? 'document_thumbnail' : 'document_preview',
          source_document_id: document.document_id,
          ...extraMetadata,
        },
      });
      return uploaded.file_id as string;
    } catch (error) {
      console.error(`[storeDerivatives] ${kind} upload failed:`, error);
      return null;
    }
  };

  const [thumbnailFileId, previewFileId] = await Promise.all([
    store('thumbnail', thumbnail),
    store('preview', preview),
  ]);

  if (!thumbnailFileId && !previewFileId) {
    const reason = thumbnail.status === 'rejected' ? thumbnail.reason : preview.status === 'rejected' ? preview.reason : null;
    throw reason instanceof Error ? reason : new Error('No preview derivative could be stored');
  }
  return { thumbnail_file_id: thumbnailFileId, preview_file_id: previewFileId };
}

/** Images: stream from storage straight into sharp. */
async function generateImagePreviews(tenant: string, document: IDocument) {
  const stream = await new StorageService().getFileReadStream(document.file_id!);
  return storeDerivatives(tenant, document, stream);
}

/**
 * PDFs: pdf2pic needs a file path, so stream the PDF to a temp file (bounded by
 * MAX_PDF_PREVIEW_BYTES), render page 1, and encode the rendered page.
 */
async function generatePdfPreviews(tenant: string, document: IDocument, declaredSize: number) {
  if (Number.isFinite(declaredSize) && declaredSize > MAX_PDF_PREVIEW_BYTES) {
    throw new PreviewSkipped(`PDF is ${declaredSize} bytes, over the ${MAX_PDF_PREVIEW_BYTES} byte preview limit`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-preview-pdf-'));
  try {
    const tempPdfPath = path.join(tempDir, `${uuidv4()}.pdf`);
    const source = await new StorageService().getFileReadStream(document.file_id!);

    let received = 0;
    const cap = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_PDF_PREVIEW_BYTES) {
          callback(new PreviewSkipped(`PDF exceeds the ${MAX_PDF_PREVIEW_BYTES} byte preview limit`));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(source, cap, createWriteStream(tempPdfPath));

    const converter = fromPath(tempPdfPath, {
      density: 150,
      saveFilename: uuidv4(),
      savePath: tempDir,
      format: 'png',
      width: 1200,
      height: 1600,
    });
    // pdf2pic cannot be aborted, so the race only frees the job; the timeout is an ordinary Error,
    // which takes the same failure path (event + rethrow => retry) as any other render failure.
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    const rendered = await Promise.race([
      converter(1, { responseType: 'buffer' }),
      new Promise<never>((_resolve, reject) => {
        renderTimer = setTimeout(
          () => reject(new Error(`PDF render timed out after ${PDF_RENDER_TIMEOUT_MS}ms`)),
          PDF_RENDER_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(renderTimer));
    if (!rendered || !rendered.buffer) {
      throw new Error('Failed to render PDF page');
    }
    return await storeDerivatives(tenant, document, rendered.buffer as Buffer);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch((cleanupError) => {
      console.error('[generatePdfPreviews] Failed to clean up temp dir:', cleanupError);
    });
  }
}

let cachedFfmpegPath: string | null | undefined;

/**
 * FFMPEG_PATH, then ffmpeg on PATH (production images), then the ffmpeg-static binary (dev, CI).
 * The first candidate that runs wins; the result is cached for the process.
 */
export function resolveFfmpegPath(): string | null {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  const candidates: string[] = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  candidates.push('ffmpeg');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bundled = require('ffmpeg-static');
    if (typeof bundled === 'string') candidates.push(bundled);
  } catch {
    // ffmpeg-static is optional.
  }
  cachedFfmpegPath =
    candidates.find((candidate) => spawnSync(candidate, ['-version'], { stdio: 'ignore' }).status === 0) ?? null;
  return cachedFfmpegPath;
}

/**
 * Extract one frame at `seekSeconds` from a seekable input into `outputPath`.
 * `-ss` before `-i` is an input seek, so ffmpeg jumps via the index (moov atom wherever it is,
 * HTTP range requests for URLs) instead of decoding from the start. Returns whether a frame was
 * written: a clip shorter than the seek point exits 0 without output.
 */
async function extractFrame(
  ffmpegPath: string,
  input: string,
  isUrl: boolean,
  seekSeconds: number,
  outputPath: string,
): Promise<boolean> {
  await fs.rm(outputPath, { force: true });
  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    ...(isUrl ? ['-protocol_whitelist', 'http,https,tcp,tls,crypto', '-rw_timeout', '30000000'] : []),
    '-ss', String(seekSeconds),
    '-i', input,
    '-frames:v', '1',
    '-an',
    '-vf', "scale='min(1280,iw)':-2",
    '-y',
    outputPath,
  ];
  await execFileAsync(ffmpegPath, args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  const stat = await fs.stat(outputPath).catch(() => null);
  return Boolean(stat && stat.size > 0);
}

/** Videos: ffmpeg reads the source itself from a seekable location; only the one frame is loaded. */
async function generateVideoPreviews(tenant: string, document: IDocument) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new PreviewSkipped('ffmpeg is not available; video previews are disabled');
  }

  const input = await StorageService.getSeekableInput(document.file_id!, SEEKABLE_URL_TTL_SECONDS);
  const location = input.kind === 'file' ? input.path : input.url;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-preview-video-'));
  try {
    const framePath = path.join(tempDir, 'frame.png');
    // One second in; clips shorter than that fall back to the first frame.
    const extracted =
      (await extractFrame(ffmpegPath, location, input.kind === 'url', 1, framePath)) ||
      (await extractFrame(ffmpegPath, location, input.kind === 'url', 0, framePath));
    if (!extracted) {
      throw new Error('ffmpeg produced no frame');
    }
    const frame = await fs.readFile(framePath); // one small PNG frame, not the video
    return await storeDerivatives(tenant, document, frame, { source_type: 'video' });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch((cleanupError) => {
      console.error('[generateVideoPreviews] Failed to clean up temp dir:', cleanupError);
    });
  }
}

/**
 * Batch process documents to generate missing previews
 * Useful for backfilling existing documents or retrying failed generations
 *
 * @param limit - Maximum number of documents to process (default: 50)
 * @returns Number of documents processed
 */
export async function batchGeneratePreviews(limit: number = 50): Promise<number> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    console.log(`[batchGeneratePreviews] Starting batch preview generation (limit: ${limit})`);

    // Find documents without previews that have files
    const documents = await tenantDb(knex, tenant).table<IDocument>('documents')
      .whereNotNull('file_id')
      .whereNull('preview_file_id')
      .limit(limit)
      .select('document_id');

    console.log(`[batchGeneratePreviews] Found ${documents.length} documents to process`);

    let processedCount = 0;
    let errorCount = 0;

    for (const doc of documents) {
      try {
        console.log(`[batchGeneratePreviews] Processing document ${doc.document_id}`);
        await generatePreviewsForDocument(doc.document_id);
        processedCount++;
      } catch (error) {
        console.error(`[batchGeneratePreviews] Error processing document ${doc.document_id}:`, error);
        errorCount++;
        // Continue processing other documents even if one fails
      }
    }

    console.log(`[batchGeneratePreviews] Completed: ${processedCount} processed, ${errorCount} errors`);
    return processedCount;
  } catch (error) {
    console.error('[batchGeneratePreviews] Batch processing error:', error);
    throw error;
  }
}

/**
 * Regenerate previews for a single document
 * Useful when preview generation fails or needs to be refreshed
 *
 * @param documentId - The document ID to regenerate previews for
 * @returns True if successful, false otherwise
 */
export async function regenerateDocumentPreview(documentId: string): Promise<boolean> {
  try {
    console.log(`[regenerateDocumentPreview] Regenerating preview for document ${documentId}`);
    const { knex, tenant } = await createTenantKnex();
    const document = tenant
      ? await tenantDb(knex, tenant).table<IDocument>('documents').where({ document_id: documentId }).first('file_id')
      : null;
    if (!document?.file_id) {
      console.error(`[regenerateDocumentPreview] Document not found or has no file: ${documentId}`);
      return false;
    }
    await generatePreviewsForDocument(documentId);
    return true;
  } catch (error) {
    console.error(`[regenerateDocumentPreview] Error regenerating preview for document ${documentId}:`, error);
    return false;
  }
}
