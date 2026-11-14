import path from 'node:path';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

import { isMimeAllowed } from './storage-mime';
import { UploadContentTypeError, UploadSizeLimitError } from '../ingest/errors';
import type { StorageConfig, StorageProviderConfig } from '../types/storage';

/**
 * THE source of truth for the per-file upload size limit.
 *
 * The limit is the default provider's `maxFileSize`, set by STORAGE_LOCAL_MAX_FILE_SIZE (local) or
 * STORAGE_S3_MAX_FILE_SIZE (s3), in bytes. Upload validation (`validateFileUpload`,
 * `validateSystemArtifact`) and the ingest pipeline enforce it on the server, and the upload-session
 * API (`getUploadPolicy`) is the only way it reaches the browser, as `maxFileSize`. No client
 * constant, Next body cap or helm `locations` block carries a second copy. Failures are an
 * `UploadSizeLimitError` (413). The helm chart defaults and `envConfig.ts` must equal this default;
 * server/src/test/unit/storageLimitDefaults.test.ts pins them together.
 *
 * A provider's own `getCapabilities().maxFileSize` is a ceiling of the backing store (S3's 5 GiB
 * single-object limit), never a second limit: it is clamped to this configured value.
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 524288000; // 500 MiB

// Cached configuration to avoid multiple async calls
let cachedConfig: StorageConfig | null = null;

// Parse environment variables or use defaults with async secret retrieval
async function buildStorageConfig(): Promise<StorageConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const secretProvider = await getSecretProviderInstance();

  // Get S3 credentials from secret provider with fallback to environment variables
  const s3AccessKey =
    (await secretProvider.getAppSecret('STORAGE_S3_ACCESS_KEY')) ?? process.env.STORAGE_S3_ACCESS_KEY;
  const s3SecretKey =
    (await secretProvider.getAppSecret('STORAGE_S3_SECRET_KEY')) ?? process.env.STORAGE_S3_SECRET_KEY;

  const defaultLocalBasePath =
    process.env.STORAGE_LOCAL_BASE_PATH || path.resolve(process.cwd(), 'tmp', 'storage');

  // Allow all file types by default (use */* wildcard)
  const defaultLocalMimeTypes = process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES || '*/*';

  cachedConfig = {
    defaultProvider: process.env.STORAGE_DEFAULT_PROVIDER || 'local',
    providers: {
      local: {
        type: 'local',
        basePath: defaultLocalBasePath,
        maxFileSize: Number(process.env.STORAGE_LOCAL_MAX_FILE_SIZE || DEFAULT_MAX_FILE_SIZE_BYTES),
        allowedMimeTypes: defaultLocalMimeTypes.split(','),
        retentionDays: parseInt(process.env.STORAGE_LOCAL_RETENTION_DAYS || '30'),
      },
      s3: {
        type: 's3',
        region: process.env.STORAGE_S3_REGION,
        bucket: process.env.STORAGE_S3_BUCKET,
        accessKey: s3AccessKey,
        secretKey: s3SecretKey,
        endpoint: process.env.STORAGE_S3_ENDPOINT,
        maxFileSize: Number(process.env.STORAGE_S3_MAX_FILE_SIZE || DEFAULT_MAX_FILE_SIZE_BYTES),
        allowedMimeTypes: (process.env.STORAGE_S3_ALLOWED_MIME_TYPES || '*/*').split(','),
        retentionDays: parseInt(process.env.STORAGE_S3_RETENTION_DAYS || '30'),
      },
    },
  };

  return cachedConfig;
}

export async function getStorageConfig(): Promise<StorageConfig> {
  return await buildStorageConfig();
}

export async function getProviderConfig(providerId: string): Promise<StorageProviderConfig> {
  const config = await buildStorageConfig();
  const provider = config.providers[providerId];
  if (!provider) {
    throw new Error(`Storage provider not found: ${providerId}`);
  }
  return provider;
}

/**
 * Who chose the MIME type of a stored object: the user behind an upload, or
 * product code generating/fetching an artifact. The default when a caller
 * omits the option is `user-upload`, so an un-migrated call site keeps the
 * attachment allowlist and cannot silently bypass it.
 */
export type StorageArtifactOrigin = 'user-upload' | 'system-artifact';

/** Shared size/provider ceiling check used by both validators. */
async function validateFileSize(fileSize: number): Promise<StorageProviderConfig> {
  const config = await buildStorageConfig();
  const provider = config.providers[config.defaultProvider];

  // The ingest pipeline's typed errors (same messages as before), so every entry point maps a
  // refusal by its type (413 / 400-415) whether it came from this pre-check or from the stream.
  if (fileSize > provider.maxFileSize) {
    throw new UploadSizeLimitError(provider.maxFileSize);
  }

  return provider;
}

/** Validate a user-supplied attachment: size ceiling plus the MIME allowlist. */
export async function validateFileUpload(mimeType: string, fileSize: number): Promise<void> {
  const provider = await validateFileSize(fileSize);

  if (!isMimeAllowed(provider.allowedMimeTypes, mimeType)) {
    throw new UploadContentTypeError('File type not allowed', mimeType, undefined);
  }
}

/**
 * Validate a system-generated artifact. The MIME type is chosen by product
 * code, not the user, so the attachment allowlist does not apply; size and
 * provider limits still do.
 */
export async function validateSystemArtifact(fileSize: number): Promise<void> {
  await validateFileSize(fileSize);
}

/** Size ceiling and MIME allowlist of the default provider, as enforced on streamed uploads. */
export async function getUploadPolicy(): Promise<{ maxFileSize: number; allowedMimeTypes: string[] }> {
  const config = await buildStorageConfig();
  const provider = config.providers[config.defaultProvider];
  return { maxFileSize: provider.maxFileSize, allowedMimeTypes: provider.allowedMimeTypes };
}

export function clearCachedStorageConfig(): void {
  cachedConfig = null;
}

