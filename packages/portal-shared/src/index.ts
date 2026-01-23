/**
 * @alga-psa/portal-shared
 *
 * Shared infrastructure for client portal functionality
 *
 * This package provides shared types and re-exports for portal invitation management,
 * allowing domain packages (@alga-psa/clients, @alga-psa/client-portal) to access
 * portal features without creating cross-layer dependencies.
 *
 * ## Architecture
 *
 * This is an Infrastructure Layer (Layer 2) package that:
 * - Exports types and interfaces for portal management
 * - Re-exports portal actions to break direct domain-to-domain dependencies
 * - Can be safely imported by multiple domain packages without violating layering
 */

export * from './actions';
export * from './types';
