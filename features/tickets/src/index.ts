/**
 * @alga-psa/feature-tickets
 *
 * Tickets feature package for Alga PSA.
 * This package encapsulates all ticket-related functionality including:
 * - Server actions for ticket CRUD operations
 * - React components for ticket UI
 * - API route handlers
 * - Data repositories
 * - Type definitions
 */

// Export actions
export * from './actions/index.js';

// Export types
export * from './types/index.js';

// Re-export for convenience
export { ticketRepository } from './repositories/index.js';
