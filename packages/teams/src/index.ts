/**
 * @alga-psa/teams
 *
 * Team management module for Alga PSA.
 *
 * Main entry point exports buildable models code only.
 * For runtime code, use:
 * - '@alga-psa/teams/actions' for server actions
 * - '@alga-psa/teams/hooks' for React hooks
 */

// Buildable exports (models)
export { default as TeamModel } from './models/team';
