import type { InternalNotification } from '../types/internalNotification';
export type NotificationDeliveryChannel = 'in_app' | 'teams' | 'push';
export type NotificationDeliveryResult =
  | { status: 'delivered' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; errorCode: string; retryable: boolean };
export type NotificationDeliveryTransport = (notification: InternalNotification) => Promise<NotificationDeliveryResult>;
