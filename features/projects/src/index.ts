/**
 * @alga-psa/feature-projects
 *
 * Projects feature package for Alga PSA.
 * This package encapsulates all project-related functionality including:
 * - Server actions for project, phase, and task CRUD operations
 * - React components for project UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { projectRepository } from './repositories/index.js';
