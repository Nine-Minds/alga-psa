// Keep legacy server imports on the same delivery authorization boundary.
export {
  getNotificationChannel,
  broadcastNotification,
  broadcastNotificationRead,
  broadcastAllNotificationsRead,
  broadcastUnreadCount,
} from '@alga-psa/notifications/realtime/internalNotificationBroadcaster';
