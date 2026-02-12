/**
 * @alga-psa/documents
 *
 * Document management module for Alga PSA.
 * Provides document storage, handlers, and templates.
 */

export * from './components';

// Avatar URL helpers (batch functions live in @alga-psa/media)
export * from './lib/avatarUtils';

// Storage utilities
export { StorageProviderFactory, generateStoragePath } from './storage/StorageProviderFactory';
