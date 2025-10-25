/**
 * Document Preview Generator
 *
 * Generates thumbnails and previews for uploaded documents at upload time.
 * This replaces the legacy on-demand preview generation system with a cached approach.
 *
 * Preview Sizes:
 * - Thumbnail: 200x200 (cover fit) - for list views and cards
 * - Preview: 800x600 (inside fit) - for preview modal/drawer
 *
 * Supported File Types:
 * - Images (image/*): Direct thumbnail/preview generation
 * - PDFs (application/pdf): Render first page to image
 * - Videos (video/*): Extract frame at 1 second (requires ffmpeg)
 * - Other types: Return null (use type-based icons in UI)
 */

import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { fromPath } from 'pdf2pic';
import { StorageService } from '../storage/StorageService';
import { createTenantKnex } from '../db';
import { IDocument } from '../../interfaces/document.interface';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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
 * Result from preview generation
 */
export interface PreviewGenerationResult {
  thumbnail_file_id: string | null;
  preview_file_id: string | null;
  preview_generated_at: Date;
}

/**
 * Generates thumbnail and preview images for a document
 *
 * @param document - The document to generate previews for
 * @param fileBuffer - The file content as a buffer
 * @returns Promise with file IDs for generated previews
 */
export async function generateDocumentPreviews(
  document: IDocument,
  fileBuffer: Buffer
): Promise<PreviewGenerationResult> {
  console.log(`[generateDocumentPreviews] Generating previews for document ${document.document_id} (${document.mime_type})`);

  try {
    const mimeType = document.mime_type?.toLowerCase() || '';

    // Determine file type and generate previews accordingly
    if (mimeType.startsWith('image/')) {
      return await generateImagePreviews(document, fileBuffer);
    } else if (mimeType === 'application/pdf') {
      return await generatePdfPreviews(document, fileBuffer);
    } else if (mimeType.startsWith('video/')) {
      return await generateVideoPreviews(document, fileBuffer);
    } else {
      // Unsupported file type - return null for previews
      console.log(`[generateDocumentPreviews] Unsupported file type: ${mimeType}`);
      return {
        thumbnail_file_id: null,
        preview_file_id: null,
        preview_generated_at: new Date(),
      };
    }
  } catch (error) {
    console.error(`[generateDocumentPreviews] Error generating previews for document ${document.document_id}:`, error);
    // Return null IDs on error - document upload should still succeed
    return {
      thumbnail_file_id: null,
      preview_file_id: null,
      preview_generated_at: new Date(),
    };
  }
}

/**
 * Generates thumbnail and preview for image files
 *
 * @param document - The document record
 * @param fileBuffer - The image file buffer
 * @returns Preview generation result
 */
async function generateImagePreviews(
  document: IDocument,
  fileBuffer: Buffer
): Promise<PreviewGenerationResult> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Get image metadata to check dimensions
    const metadata = await sharp(fileBuffer).metadata();
    console.log(`[generateImagePreviews] Image dimensions: ${metadata.width}x${metadata.height}`);

    let thumbnailFileId: string | null = null;
    let previewFileId: string | null = null;

    // Generate thumbnail (200x200 cover crop)
    try {
      const thumbnailBuffer = await sharp(fileBuffer)
        .resize(PREVIEW_SIZES.thumbnail.width, PREVIEW_SIZES.thumbnail.height, {
          fit: PREVIEW_SIZES.thumbnail.fit,
          withoutEnlargement: false, // Always generate thumbnail even for small images
        })
        .jpeg({ quality: QUALITY_SETTINGS.thumbnail })
        .toBuffer();

      // Upload thumbnail to storage
      const thumbnailFileName = `${document.document_id}_thumbnail.jpg`;
      const thumbnailUploadResult = await StorageService.uploadFile(
        tenant,
        thumbnailBuffer,
        thumbnailFileName,
        {
          mime_type: 'image/jpeg',
          uploaded_by_id: document.created_by,
          metadata: {
            context: 'document_thumbnail',
            source_document_id: document.document_id,
          },
        }
      );

      thumbnailFileId = thumbnailUploadResult.file_id;
      console.log(`[generateImagePreviews] Thumbnail generated: ${thumbnailFileId}`);
    } catch (thumbnailError) {
      console.error('[generateImagePreviews] Thumbnail generation failed:', thumbnailError);
      // Continue to try preview generation even if thumbnail fails
    }

    // Generate preview (800x600 inside fit) - only if image is larger
    try {
      const shouldGeneratePreview =
        (metadata.width && metadata.width > PREVIEW_SIZES.preview.width) ||
        (metadata.height && metadata.height > PREVIEW_SIZES.preview.height);

      if (shouldGeneratePreview) {
        const previewBuffer = await sharp(fileBuffer)
          .resize(PREVIEW_SIZES.preview.width, PREVIEW_SIZES.preview.height, {
            fit: PREVIEW_SIZES.preview.fit,
            withoutEnlargement: true,
          })
          .jpeg({ quality: QUALITY_SETTINGS.preview })
          .toBuffer();

        // Upload preview to storage
        const previewFileName = `${document.document_id}_preview.jpg`;
        const previewUploadResult = await StorageService.uploadFile(
          tenant,
          previewBuffer,
          previewFileName,
          {
            mime_type: 'image/jpeg',
            uploaded_by_id: document.created_by,
            metadata: {
              context: 'document_preview',
              source_document_id: document.document_id,
            },
          }
        );

        previewFileId = previewUploadResult.file_id;
        console.log(`[generateImagePreviews] Preview generated: ${previewFileId}`);
      } else {
        // Image is small - use original file for preview
        previewFileId = document.file_id || null;
        console.log(`[generateImagePreviews] Image is small, using original as preview`);
      }
    } catch (previewError) {
      console.error('[generateImagePreviews] Preview generation failed:', previewError);
      // Fall back to original file for preview
      previewFileId = document.file_id || null;
    }

    return {
      thumbnail_file_id: thumbnailFileId,
      preview_file_id: previewFileId,
      preview_generated_at: new Date(),
    };
  } catch (error) {
    console.error('[generateImagePreviews] Error:', error);
    throw error;
  }
}

/**
 * Generates thumbnail and preview for PDF files
 * Renders the first page of the PDF to an image
 *
 * @param document - The document record
 * @param fileBuffer - The PDF file buffer
 * @returns Preview generation result
 */
async function generatePdfPreviews(
  document: IDocument,
  fileBuffer: Buffer
): Promise<PreviewGenerationResult> {
  let tempPdfPath: string | null = null;

  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Create temporary file for PDF (pdf2pic requires a file path)
    const tempDir = os.tmpdir();
    tempPdfPath = path.join(tempDir, `${uuidv4()}.pdf`);
    await fs.writeFile(tempPdfPath, fileBuffer);

    // Configure pdf2pic to render first page
    const options = {
      density: 150, // DPI for rendering
      saveFilename: uuidv4(),
      savePath: tempDir,
      format: 'png',
      width: 1200, // Render at higher resolution for quality
      height: 1600,
    };

    const converter = fromPath(tempPdfPath, options);

    // Render first page
    const result = await converter(1, { responseType: 'buffer' });

    if (!result || !result.buffer) {
      throw new Error('Failed to render PDF page');
    }

    const renderedImageBuffer = result.buffer as Buffer;
    console.log(`[generatePdfPreviews] PDF first page rendered`);

    // Now generate thumbnail and preview from the rendered image
    let thumbnailFileId: string | null = null;
    let previewFileId: string | null = null;

    // Generate thumbnail (200x200 cover crop)
    try {
      const thumbnailBuffer = await sharp(renderedImageBuffer)
        .resize(PREVIEW_SIZES.thumbnail.width, PREVIEW_SIZES.thumbnail.height, {
          fit: PREVIEW_SIZES.thumbnail.fit,
        })
        .jpeg({ quality: QUALITY_SETTINGS.thumbnail })
        .toBuffer();

      const thumbnailFileName = `${document.document_id}_thumbnail.jpg`;
      const thumbnailUploadResult = await StorageService.uploadFile(
        tenant,
        thumbnailBuffer,
        thumbnailFileName,
        {
          mime_type: 'image/jpeg',
          uploaded_by_id: document.created_by,
          metadata: {
            context: 'document_thumbnail',
            source_document_id: document.document_id,
          },
        }
      );

      thumbnailFileId = thumbnailUploadResult.file_id;
      console.log(`[generatePdfPreviews] Thumbnail generated: ${thumbnailFileId}`);
    } catch (thumbnailError) {
      console.error('[generatePdfPreviews] Thumbnail generation failed:', thumbnailError);
    }

    // Generate preview (800x600 inside fit)
    try {
      const previewBuffer = await sharp(renderedImageBuffer)
        .resize(PREVIEW_SIZES.preview.width, PREVIEW_SIZES.preview.height, {
          fit: PREVIEW_SIZES.preview.fit,
          withoutEnlargement: true,
        })
        .jpeg({ quality: QUALITY_SETTINGS.preview })
        .toBuffer();

      const previewFileName = `${document.document_id}_preview.jpg`;
      const previewUploadResult = await StorageService.uploadFile(
        tenant,
        previewBuffer,
        previewFileName,
        {
          mime_type: 'image/jpeg',
          uploaded_by_id: document.created_by,
          metadata: {
            context: 'document_preview',
            source_document_id: document.document_id,
          },
        }
      );

      previewFileId = previewUploadResult.file_id;
      console.log(`[generatePdfPreviews] Preview generated: ${previewFileId}`);
    } catch (previewError) {
      console.error('[generatePdfPreviews] Preview generation failed:', previewError);
    }

    return {
      thumbnail_file_id: thumbnailFileId,
      preview_file_id: previewFileId,
      preview_generated_at: new Date(),
    };
  } catch (error) {
    console.error('[generatePdfPreviews] Error:', error);
    throw error;
  } finally {
    // Clean up temporary PDF file
    if (tempPdfPath) {
      try {
        await fs.unlink(tempPdfPath);
      } catch (cleanupError) {
        console.error('[generatePdfPreviews] Failed to clean up temp file:', cleanupError);
      }
    }
  }
}

/**
 * Generates thumbnail and preview for video files
 * Extracts a frame at 1 second (or 0s if seeking not supported)
 *
 * NOTE: This function requires ffmpeg to be installed on the system.
 * To install ffmpeg:
 * - macOS: brew install ffmpeg
 * - Ubuntu/Debian: apt-get install ffmpeg
 * - Windows: Download from https://ffmpeg.org/download.html
 *
 * TODO: Add fluent-ffmpeg npm package for video processing
 *
 * @param document - The document record
 * @param fileBuffer - The video file buffer
 * @returns Preview generation result
 */
async function generateVideoPreviews(
  document: IDocument,
  fileBuffer: Buffer
): Promise<PreviewGenerationResult> {
  let tempVideoPath: string | null = null;
  let tempFramePath: string | null = null;

  try {
    // Check if fluent-ffmpeg is available
    let ffmpeg;
    try {
      ffmpeg = require('fluent-ffmpeg');
    } catch (requireError) {
      console.warn('[generateVideoPreviews] fluent-ffmpeg not installed. Install with: npm install fluent-ffmpeg');
      console.warn('[generateVideoPreviews] Video previews disabled until ffmpeg is installed');
      return {
        thumbnail_file_id: null,
        preview_file_id: null,
        preview_generated_at: new Date(),
      };
    }

    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    console.log(`[generateVideoPreviews] Extracting frame from video for document ${document.document_id}`);

    // Create temporary files for video and extracted frame
    const tempDir = os.tmpdir();
    const videoExtension = document.mime_type?.split('/')[1] || 'mp4';
    tempVideoPath = path.join(tempDir, `${uuidv4()}.${videoExtension}`);
    tempFramePath = path.join(tempDir, `${uuidv4()}.png`);

    // Write video buffer to temporary file
    await fs.writeFile(tempVideoPath, fileBuffer);

    // Extract frame at 1 second (with fallback to 0s)
    await new Promise<void>((resolve, reject) => {
      const extractFrame = (timestamp: string) => {
        return new Promise<void>((resolveExtract, rejectExtract) => {
          if (!tempFramePath) {
            rejectExtract(new Error('tempFramePath is null'));
            return;
          }

          ffmpeg(tempVideoPath)
            .screenshots({
              timestamps: [timestamp],
              filename: path.basename(tempFramePath),
              folder: path.dirname(tempFramePath),
              size: '1280x720',
            })
            .on('end', () => {
              console.log(`[generateVideoPreviews] Frame extracted at ${timestamp}`);
              resolveExtract();
            })
            .on('error', (err: Error) => {
              console.error(`[generateVideoPreviews] Failed to extract frame at ${timestamp}:`, err.message);
              rejectExtract(err);
            });
        });
      };

      // Try extracting at 1 second first, fallback to 0s if it fails
      extractFrame('00:00:01')
        .then(() => resolve())
        .catch(() => {
          console.log('[generateVideoPreviews] Retrying frame extraction at 00:00:00');
          extractFrame('00:00:00')
            .then(() => resolve())
            .catch((err) => {
              console.error('[generateVideoPreviews] Failed to extract frame at both timestamps');
              reject(err);
            });
        });
    });

    // Read the extracted frame
    const frameBuffer = await fs.readFile(tempFramePath);
    console.log(`[generateVideoPreviews] Frame buffer size: ${frameBuffer.length} bytes`);

    // Now generate thumbnail and preview from the extracted frame (same as image processing)
    let thumbnailFileId: string | null = null;
    let previewFileId: string | null = null;

    // Generate thumbnail (200x200 cover crop)
    try {
      const thumbnailBuffer = await sharp(frameBuffer)
        .resize(PREVIEW_SIZES.thumbnail.width, PREVIEW_SIZES.thumbnail.height, {
          fit: PREVIEW_SIZES.thumbnail.fit,
        })
        .jpeg({ quality: QUALITY_SETTINGS.thumbnail })
        .toBuffer();

      const thumbnailFileName = `${document.document_id}_thumbnail.jpg`;
      const thumbnailUploadResult = await StorageService.uploadFile(
        tenant,
        thumbnailBuffer,
        thumbnailFileName,
        {
          mime_type: 'image/jpeg',
          uploaded_by_id: document.created_by,
          metadata: {
            context: 'document_thumbnail',
            source_document_id: document.document_id,
            source_type: 'video',
          },
        }
      );

      thumbnailFileId = thumbnailUploadResult.file_id;
      console.log(`[generateVideoPreviews] Thumbnail generated: ${thumbnailFileId}`);
    } catch (thumbnailError) {
      console.error('[generateVideoPreviews] Thumbnail generation failed:', thumbnailError);
    }

    // Generate preview (800x600 inside fit)
    try {
      const previewBuffer = await sharp(frameBuffer)
        .resize(PREVIEW_SIZES.preview.width, PREVIEW_SIZES.preview.height, {
          fit: PREVIEW_SIZES.preview.fit,
          withoutEnlargement: true,
        })
        .jpeg({ quality: QUALITY_SETTINGS.preview })
        .toBuffer();

      const previewFileName = `${document.document_id}_preview.jpg`;
      const previewUploadResult = await StorageService.uploadFile(
        tenant,
        previewBuffer,
        previewFileName,
        {
          mime_type: 'image/jpeg',
          uploaded_by_id: document.created_by,
          metadata: {
            context: 'document_preview',
            source_document_id: document.document_id,
            source_type: 'video',
          },
        }
      );

      previewFileId = previewUploadResult.file_id;
      console.log(`[generateVideoPreviews] Preview generated: ${previewFileId}`);
    } catch (previewError) {
      console.error('[generateVideoPreviews] Preview generation failed:', previewError);
    }

    return {
      thumbnail_file_id: thumbnailFileId,
      preview_file_id: previewFileId,
      preview_generated_at: new Date(),
    };
  } catch (error) {
    console.error('[generateVideoPreviews] Error:', error);
    // Return null instead of throwing - allow video upload to succeed even if preview fails
    return {
      thumbnail_file_id: null,
      preview_file_id: null,
      preview_generated_at: new Date(),
    };
  } finally {
    // Clean up temporary files
    if (tempVideoPath) {
      try {
        await fs.unlink(tempVideoPath);
        console.log('[generateVideoPreviews] Cleaned up temporary video file');
      } catch (cleanupError) {
        console.error('[generateVideoPreviews] Failed to clean up temp video file:', cleanupError);
      }
    }
    if (tempFramePath) {
      try {
        await fs.unlink(tempFramePath);
        console.log('[generateVideoPreviews] Cleaned up temporary frame file');
      } catch (cleanupError) {
        console.error('[generateVideoPreviews] Failed to clean up temp frame file:', cleanupError);
      }
    }
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
    const documents = await knex('documents')
      .where({ tenant })
      .whereNotNull('file_id')
      .whereNull('preview_file_id')
      .limit(limit)
      .select('*');

    console.log(`[batchGeneratePreviews] Found ${documents.length} documents to process`);

    let processedCount = 0;
    let errorCount = 0;

    for (const doc of documents) {
      try {
        console.log(`[batchGeneratePreviews] Processing document ${doc.document_id}`);

        // Download file from storage
        const downloadResult = await StorageService.downloadFile(doc.file_id);
        if (!downloadResult) {
          console.error(`[batchGeneratePreviews] File not found for document ${doc.document_id}`);
          errorCount++;
          continue;
        }

        // Generate previews
        const previewResult = await generateDocumentPreviews(doc, downloadResult.buffer);

        // Update document with preview file IDs
        await knex('documents')
          .where({ document_id: doc.document_id, tenant })
          .update({
            thumbnail_file_id: previewResult.thumbnail_file_id,
            preview_file_id: previewResult.preview_file_id,
            preview_generated_at: previewResult.preview_generated_at,
            updated_at: new Date(),
          });

        processedCount++;
        console.log(`[batchGeneratePreviews] Successfully processed document ${doc.document_id}`);
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
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    console.log(`[regenerateDocumentPreview] Regenerating preview for document ${documentId}`);

    // Get document
    const document = await knex('documents')
      .where({ document_id: documentId, tenant })
      .first();

    if (!document) {
      console.error(`[regenerateDocumentPreview] Document not found: ${documentId}`);
      return false;
    }

    if (!document.file_id) {
      console.error(`[regenerateDocumentPreview] Document has no file: ${documentId}`);
      return false;
    }

    // Download file from storage
    const downloadResult = await StorageService.downloadFile(document.file_id);
    if (!downloadResult) {
      console.error(`[regenerateDocumentPreview] File not found for document ${documentId}`);
      return false;
    }

    // Generate previews
    const previewResult = await generateDocumentPreviews(document, downloadResult.buffer);

    // Update document with preview file IDs
    await knex('documents')
      .where({ document_id: documentId, tenant })
      .update({
        thumbnail_file_id: previewResult.thumbnail_file_id,
        preview_file_id: previewResult.preview_file_id,
        preview_generated_at: previewResult.preview_generated_at,
        updated_at: new Date(),
      });

    console.log(`[regenerateDocumentPreview] Successfully regenerated preview for document ${documentId}`);
    return true;
  } catch (error) {
    console.error(`[regenerateDocumentPreview] Error regenerating preview for document ${documentId}:`, error);
    return false;
  }
}
