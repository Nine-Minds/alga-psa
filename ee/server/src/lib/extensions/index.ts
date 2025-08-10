/**
 * Extension System
 *
 * Main entry point for the extension system
 */

// Export core types and interfaces
export * from './types';
export * from './errors';

// Export registry and validation
export { ExtensionRegistry } from './registry';

// Manifest v2-first exports
export { manifestV2Schema, validateManifestV2 } from './schemas/manifest-v2.schema';
export type { ManifestV2 } from './schemas/manifest-v2.schema';

// Export UI components
export * from './ui';

// Export storage service
export { ExtensionStorageService } from './storage/storageService';