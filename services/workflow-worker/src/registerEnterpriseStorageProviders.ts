import logger from '@alga-psa/core/logger';

export async function registerEnterpriseStorageProviders(): Promise<void> {
  const isEnterprise =
    process.env.EDITION === 'enterprise' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  if (!isEnterprise) return;

  try {
    const eeScope = '@' + 'ee';
    const moduleSpecifier = `${eeScope}/lib/storage/providers/S3StorageProvider`;
    const mod = (await import(moduleSpecifier)) as any;
    const S3StorageProvider = mod?.S3StorageProvider;

    if (!S3StorageProvider) {
      throw new Error('S3StorageProvider export not found');
    }

    (global as any).S3StorageProvider = S3StorageProvider;
    logger.info('[WorkflowWorker] Registered S3StorageProvider for enterprise edition');
  } catch (error) {
    logger.warn(
      '[WorkflowWorker] S3StorageProvider not available; continuing without S3 provider',
      error,
    );
  }
}
