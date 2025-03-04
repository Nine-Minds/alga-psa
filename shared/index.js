/**
 * Main entry point for the shared package
 * 
 * This file re-exports all public modules from the shared package.
 * Applications should import from these modules rather than directly
 * accessing internal files.
 */

// Re-export all public modules
export * from './types/index.js';

// These will be implemented as we extract code
// export * from './core/index.js';
// export * from './workflow/index.js';
