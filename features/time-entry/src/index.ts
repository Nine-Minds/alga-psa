/**
 * @alga-psa/feature-time-entry
 *
 * Time entry feature package for Alga PSA.
 * This package encapsulates all time entry-related functionality including:
 * - Server actions for time entry CRUD operations
 * - React components for time entry UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { timeEntryRepository } from './repositories/index.js';
