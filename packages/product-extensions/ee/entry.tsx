// EE implementation for Extensions feature
// This exports the actual EE extensions page component

// Export the EE extensions page with both default export and metadata
export { default, metadata } from '../../../ee/ee/server/src/app/msp/extensions/[id]/page.js';

// Re-export for named imports if needed
export { default as ExtensionPage, metadata as ExtensionPageMetadata } from '../../../ee/ee/server/src/app/msp/extensions/[id]/page.js';
