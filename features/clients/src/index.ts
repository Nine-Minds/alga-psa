/**
 * @alga-psa/feature-clients
 *
 * Clients feature package for Alga PSA.
 * This package encapsulates all client-related functionality including:
 * - Server actions for client CRUD operations
 * - React components for client UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { clientRepository } from './repositories/index.js';
