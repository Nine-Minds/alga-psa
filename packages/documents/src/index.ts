/**
 * @alga-psa/documents
 *
 * Main entry point exports buildable lib/models/handlers/storage code only.
 * For runtime code, use:
 * - '@alga-psa/documents/actions' for server actions
 * - '@alga-psa/documents/components' for React components
 */

// Document utilities (buildable)
// Note: avatarUtils and entityImageService are runtime-only (import from '@alga-psa/documents/lib/avatarUtils' etc.)
export * from './lib/documentUtils';
export * from './lib/documentPermissionUtils';
export * from './lib/documentPreviewGenerator';
export * from './lib/blocknoteUtils';

// Storage utilities (buildable)
export { StorageProviderFactory, generateStoragePath } from './storage/StorageProviderFactory';
export { StorageService } from './storage/StorageService';
export * from './storage/providers/StorageProvider';
export * from './storage/providers/LocalStorageProvider';

// Models (buildable)
export * from './models';

// Handlers (buildable)
export * from './handlers';

// Cache (buildable)
export * from './cache/CacheFactory';
export * from './cache/PreviewCacheProvider';

// Config (buildable)
export * from './config/storage';
