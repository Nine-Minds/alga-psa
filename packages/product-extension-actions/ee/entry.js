// EE implementation for Extension actions
// This re-exports the actual EE extension actions

// Re-export installDomainActions
export { validate, lookupByHost } from '../../../ee/server/src/lib/actions/installDomainActions.js';

// Re-export extMenuActions
export { listAppMenuItemsForTenant } from '../../../ee/server/src/lib/actions/extMenuActions.js';

// Re-export types
export type { AppMenuItem } from '../../../ee/server/src/lib/actions/extMenuActions.js';
