/**
 * @alga-psa/feature-assets
 *
 * Assets feature package for Alga PSA.
 * This package encapsulates all asset-related functionality including:
 * - Server actions for asset CRUD operations
 * - React components for asset UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { assetRepository } from './repositories/index.js';
