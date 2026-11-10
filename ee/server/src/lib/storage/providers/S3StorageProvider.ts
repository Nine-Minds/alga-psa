// EE registration seam for the S3 storage provider. The implementation lives in
// @alga-psa/storage (one real S3 provider); CE builds swap this module for the stub in
// packages/ee via NormalModuleReplacementPlugin (server/next.config.mjs), so no EE code
// enters CE builds and `@ee/lib/storage/providers/S3StorageProvider` keeps resolving.
export { S3StorageProvider } from '@alga-psa/storage/providers/S3StorageProvider';
