/**
 * @alga-psa/tags
 *
 * Tag management module for Alga PSA.
 *
 * Main entry point exports buildable lib/models code only.
 * For runtime code, use:
 * - '@alga-psa/tags/actions' for server actions
 * - '@alga-psa/tags/components' for React components
 * - '@alga-psa/tags/context' for React context
 * - '@alga-psa/tags/hooks' for React hooks
 */

// Buildable exports (lib and models)
export * from './lib/colorUtils';
export * from './lib/permissions';
export * from './lib/tagCleanup';
export * from './lib/uiHelpers';
export * from './lib/usersHelpers';
export * from './lib/authHelpers';

// Models
export { default as TagDefinition, type ITagDefinition } from './models/tagDefinition';
export { default as TagMapping, type ITagMapping, type ITagWithDefinition } from './models/tagMapping';
