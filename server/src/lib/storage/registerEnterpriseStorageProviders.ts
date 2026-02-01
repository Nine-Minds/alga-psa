import { logger } from '@alga-psa/core';

/**
 * Edition-neutral entrypoint for registering Enterprise storage providers.
 *
 * CE default: no-op.
 * EE builds should alias this module to an EE implementation that sets globals like S3StorageProvider.
 */
export async function registerEnterpriseStorageProviders(): Promise<void> {
  try {
    const mod = await import('@enterprise/lib/storage/providers/S3StorageProvider');
    const S3StorageProvider = (mod as any)?.S3StorageProvider;
    if (!S3StorageProvider) {
      throw new Error('S3StorageProvider export not found');
    }
    (global as any).S3StorageProvider = S3StorageProvider;
    logger.info('[storage] Registered S3StorageProvider');
  } catch (error) {
    logger.warn('[storage] S3StorageProvider not available; continuing without S3 provider', error);
  }
}
