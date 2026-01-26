/**
 * @alga-psa/users
 *
 * User management module for Alga PSA.
 *
 * Main entry point exports buildable lib/services code only.
 * For runtime code, use:
 * - '@alga-psa/users/actions' for server actions
 * - '@alga-psa/users/components' for React components
 * - '@alga-psa/users/hooks' for React hooks
 */

// Buildable exports (lib only)
// Note: UserService is runtime-only due to missing schemas/userSchemas
export * from './lib/avatarUtils';
export * from './lib/permissions';
export * from './lib/rateLimiting';
export * from './lib/roleActions';
