'use server';

import type { PlatformNotification } from './platformNotificationService';

/**
 * Platform Notification Actions - CE Empty Stub
 */

export async function getActivePlatformNotifications(): Promise<PlatformNotification[]> {
  return [];
}

export async function dismissPlatformNotification(_notificationId: string): Promise<void> {}

export async function recordPlatformNotificationDetailView(_notificationId: string): Promise<void> {}
