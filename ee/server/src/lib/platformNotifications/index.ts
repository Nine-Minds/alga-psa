/**
 * Platform Notifications Module
 *
 * Cross-tenant announcements/alerts for Nine Minds platform administration.
 */

export { PlatformNotificationService } from './platformNotificationService';
export type {
  PlatformNotification,
  CreateNotificationInput,
  UpdateNotificationInput,
  RecipientInput,
  NotificationStats,
  ResolvedRecipient,
  TargetAudience,
  TargetAudienceFilters,
} from './platformNotificationService';
