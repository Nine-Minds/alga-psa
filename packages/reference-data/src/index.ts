/**
 * @alga-psa/reference-data
 *
 * Reference data management module for Alga PSA.
 *
 * Main entry point exports buildable models code only.
 * For runtime code, use:
 * - '@alga-psa/reference-data/actions' for server actions
 * - '@alga-psa/reference-data/components' for React components
 */

// Buildable exports (models)
export { default as Priority } from './models/priority';
