/**
 * @alga-psa/feature-contacts
 *
 * Contacts feature package for Alga PSA.
 * This package encapsulates all contact-related functionality including:
 * - Server actions for contact CRUD operations
 * - React components for contact UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { contactRepository } from './repositories/index.js';
