/**
 * @alga-psa/documents
 *
 * Document management module for Alga PSA.
 * Provides document storage, handlers, and templates.
 */

export * from './components';

// Entity image upload/delete service (avatarUtils now lives in @alga-psa/formatting)
export * from './lib/entityImageService';

// Storage utilities
export { StorageProviderFactory, generateStoragePath } from '@alga-psa/storage';
