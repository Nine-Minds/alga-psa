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
export { validateManifest } from './validator';
export { isValidPermission } from './schemas/permissions.schema';
export { isValidExtensionPoint } from './schemas/extension-points.schema';

// Export UI components
export * from './ui';

// Export storage service
export { ExtensionStorageService } from './storage/storageService';