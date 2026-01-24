// Re-export EE Quick Ask overlay implementation for CE-first app imports.
// The primary implementation lives in `ee/server` alongside the EE chat UI.

export { default } from '../../../../../ee/server/src/components/chat/QuickAskOverlay';
export * from '../../../../../ee/server/src/components/chat/QuickAskOverlay';

