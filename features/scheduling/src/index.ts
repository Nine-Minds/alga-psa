/**
 * @alga-psa/feature-scheduling
 *
 * Scheduling feature package for Alga PSA.
 * This package encapsulates all scheduling-related functionality including:
 * - Server actions for schedule CRUD operations
 * - React components for scheduling UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { scheduleRepository } from './repositories/index.js';
