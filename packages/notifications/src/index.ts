/**
 * @alga-psa/notifications
 *
 * Main entry point exports buildable lib/types code only.
 * For runtime code, use:
 * - '@alga-psa/notifications/actions' for server actions
 * - '@alga-psa/notifications/components' for React components
 * - '@alga-psa/notifications/hooks' for React hooks
 */

// Buildable exports
export * from './emailChannel';
export * from './types/internalNotification';
export * from './types/notification';
export * from './db';
export * from './lib/authHelpers';
export * from './realtime/internalNotificationBroadcaster';
export * from './notifications/emailLocaleResolver';
export * from './notifications/email';
