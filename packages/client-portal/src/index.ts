/**
 * @alga-psa/client-portal
 *
 * Client-facing portal module for Alga PSA.
 * Provides the customer-facing interface for ticket submission,
 * knowledge base access, and account management.
 *
 * Main entry point exports buildable schemas only.
 * For runtime code, use:
 * - '@alga-psa/client-portal/actions' for server actions
 * - '@alga-psa/client-portal/components' for React components
 * - '@alga-psa/client-portal/models' for models with database operations
 * - '@alga-psa/client-portal/services' for service classes
 */

// Buildable exports (schemas only)
export * from './schemas/appointmentSchemas';
