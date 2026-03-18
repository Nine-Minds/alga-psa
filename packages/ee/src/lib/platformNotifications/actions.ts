'use server';

/**
 * Platform Notification Actions - CE Empty Stub
 */

export async function getActivePlatformNotifications(): Promise<never[]> {
  return [];
}

export async function dismissPlatformNotification(_notificationId: string): Promise<void> {}

export async function recordPlatformNotificationDetailView(_notificationId: string): Promise<void> {}
