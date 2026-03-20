'use server';

import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { PlatformNotificationService } from './platformNotificationService';
import type { PlatformNotification } from './platformNotificationService';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

function getService(): PlatformNotificationService | null {
  if (!MASTER_BILLING_TENANT_ID) return null;
  return new PlatformNotificationService(MASTER_BILLING_TENANT_ID);
}

/**
 * Get active notifications for the current user.
 * Returns empty array if not authenticated or no notifications.
 */
export async function getActivePlatformNotifications(): Promise<PlatformNotification[]> {
  try {
    const user = await getCurrentUser();
    if (!user) return [];

    const service = getService();
    if (!service) return [];

    const userRoles = (user.roles || []).map((r: { role_name: string }) => r.role_name);
    const userType = user.user_type || 'internal';

    return await service.getActiveNotificationsForUser(
      user.tenant,
      user.user_id,
      userRoles,
      userType
    );
  } catch (error) {
    console.error('[platformNotifications/actions] getActive error:', error);
    return [];
  }
}

/**
 * Dismiss a notification for the current user.
 */
export async function dismissPlatformNotification(notificationId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    const service = getService();
    if (!service) return;

    await service.dismissNotification(user.tenant, notificationId, user.user_id);
  } catch (error) {
    console.error('[platformNotifications/actions] dismiss error:', error);
  }
}

/**
 * Record that the current user viewed the detail page of a notification.
 */
export async function recordPlatformNotificationDetailView(notificationId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    const service = getService();
    if (!service) return;

    await service.recordDetailView(user.tenant, notificationId, user.user_id);
  } catch (error) {
    console.error('[platformNotifications/actions] recordDetailView error:', error);
  }
}
