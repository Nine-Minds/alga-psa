/**
 * MinIO Test Helper
 *
 * Provides utilities for verifying file uploads to MinIO during Playwright tests.
 * Uses the same S3 client configuration as the application.
 */

import { getS3Client, getBucket, headObject, getObjectStream } from 'ee/server/src/lib/storage/s3-client';
import { Readable } from 'stream';

/**
 * Check if a file exists in MinIO/S3
 */
export async function minioFileExists(storageKey: string): Promise<boolean> {
  try {
    const result = await headObject(storageKey);
    return result.exists;
  } catch (error) {
    console.error(`Error checking MinIO file existence for key ${storageKey}:`, error);
    return false;
  }
}

/**
 * Get file metadata from MinIO/S3
 */
export async function getMinioFileMetadata(storageKey: string): Promise<{
  exists: boolean;
  size?: number;
  contentType?: string;
  eTag?: string;
  lastModified?: Date;
}> {
  try {
    const result = await headObject(storageKey);
    return {
      exists: result.exists,
      size: result.contentLength,
      contentType: result.contentType,
      eTag: result.eTag,
      lastModified: result.lastModified,
    };
  } catch (error) {
    console.error(`Error getting MinIO file metadata for key ${storageKey}:`, error);
    return { exists: false };
  }
}

/**
 * Download file content from MinIO/S3 as a buffer
 */
export async function downloadMinioFile(storageKey: string): Promise<Buffer> {
  try {
    const result = await getObjectStream(storageKey);
    const stream = result.stream as Readable;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  } catch (error) {
    console.error(`Error downloading MinIO file for key ${storageKey}:`, error);
    throw error;
  }
}

/**
 * Verify file content matches expected buffer
 */
export async function verifyMinioFileContent(
  storageKey: string,
  expectedBuffer: Buffer
): Promise<{ matches: boolean; actualSize?: number; expectedSize: number }> {
  try {
    const actualBuffer = await downloadMinioFile(storageKey);
    const matches = Buffer.compare(actualBuffer, expectedBuffer) === 0;

    return {
      matches,
      actualSize: actualBuffer.length,
      expectedSize: expectedBuffer.length,
    };
  } catch (error) {
    console.error(`Error verifying MinIO file content for key ${storageKey}:`, error);
    return {
      matches: false,
      expectedSize: expectedBuffer.length,
    };
  }
}

/**
 * Get the bucket name used for storage
 */
export function getStorageBucket(): string {
  return getBucket();
}

/**
 * Wait for file to appear in MinIO (useful for async uploads)
 */
export async function waitForMinioFile(
  storageKey: string,
  options: {
    maxAttempts?: number;
    delayMs?: number;
  } = {}
): Promise<boolean> {
  const { maxAttempts = 10, delayMs = 500 } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const exists = await minioFileExists(storageKey);
    if (exists) {
      return true;
    }

    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return false;
}

/**
 * Helper to extract storage path from file_store table record
 */
export function extractStorageKeyFromPath(storagePath: string): string {
  // The storage_path in the database should already be the S3 key
  return storagePath;
}
