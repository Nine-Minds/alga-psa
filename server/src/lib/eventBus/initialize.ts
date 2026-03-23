import { registerAllSubscribers } from './subscribers';
import logger from '@alga-psa/core/logger';
import { getEventBus } from './index';
import { registerInternalNotificationHook } from '@alga-psa/notifications/actions';
import { triggerPushForNotification } from '../pushNotifications/pushNotificationDispatcher';

export async function initializeEventBus(): Promise<void> {
  try {
    logger.info('Initializing event bus and subscribers');

    // Register push notification hook for internal notifications
    registerInternalNotificationHook((notification) => {
      triggerPushForNotification(notification).catch((err) =>
        logger.error('[Push] Failed to send push notification', { err, template: notification.template_name }),
      );
    });

    // Register all subscribers
    await registerAllSubscribers();

    // Ensure event bus is initialized so subscriber handlers are registered
    await getEventBus().initialize();

    // Register SIGTERM handler for graceful shutdown
    process.on('SIGTERM', () => cleanupEventBus());

    logger.info('Event bus initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize event bus:', error);
  }
}

export async function cleanupEventBus(): Promise<void> {
  try {
    logger.info('Shutting down event bus subscribers');
    // Currently no long-lived subscriber resources to dispose.
    logger.info('Event bus cleanup completed successfully');
  } catch (error) {
    logger.error('Failed to cleanup event bus:', error);
    throw error;
  }
}
