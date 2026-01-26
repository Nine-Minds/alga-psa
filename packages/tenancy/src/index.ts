/**
 * @alga-psa/tenancy
 *
 * Tenancy management module for Alga PSA.
 *
 * Main entry point exports buildable lib code only.
 * For runtime code, use:
 * - '@alga-psa/tenancy/actions' for server actions
 * - '@alga-psa/tenancy/components' for React components
 * - '@alga-psa/tenancy/server' for server-side utilities
 * - '@alga-psa/tenancy/client' for client-side utilities
 */

// Buildable exports (lib)
export * from './lib/generateBrandingStyles';
export * from './lib/PortalDomainModel';
