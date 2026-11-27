/**
 * @alga-psa/notifications
 */

export * from './actions';
export * from './emailChannel';
export { EmailNotificationService, getEmailNotificationService } from './notifications/email';
export { resolveEmailPreferenceEnabled } from './notifications/emailPreferenceState';
export * from './types/internalNotification';
export * from './types/notification';
