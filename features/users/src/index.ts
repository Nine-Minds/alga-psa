/**
 * @alga-psa/feature-users
 *
 * Users feature package for Alga PSA.
 * This package encapsulates all user-related functionality including:
 * - Server actions for user CRUD operations
 * - React components for user UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { userRepository } from './repositories/index.js';
