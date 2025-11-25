/**
 * @alga-psa/feature-invoicing
 *
 * Invoicing feature package for Alga PSA.
 * This package encapsulates all invoice-related functionality including:
 * - Server actions for invoice CRUD and generation operations
 * - React components for invoice UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { invoiceRepository } from './repositories/index.js';
