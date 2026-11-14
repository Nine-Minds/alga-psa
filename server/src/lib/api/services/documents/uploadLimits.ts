import { getStorageConfig } from '@alga-psa/storage/config/storage';

/**
 * The default storage provider's max file size. Lives apart from resolveSource so request-bounding
 * code (multipartCap) does not pull in the URL fetch and allowlist modules.
 */
export async function getMaxUploadBytes(): Promise<number> {
  const config = await getStorageConfig();
  return config.providers[config.defaultProvider].maxFileSize;
}
