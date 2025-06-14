'use server';

import { createNotificationAction } from './inAppNotificationActions';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from '../user-actions/userActions';

/**
 * Create a test notification for the current user to verify the system is working
 */
export async function createTestNotificationAction(): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const currentUser = await getCurrentUser();

    if (!tenant || !currentUser) {
      return { success: false, error: 'Authentication required' };
    }

    // Get a notification type
    const notificationType = await knex('internal_notification_types')
      .where('type_name', 'TICKET_CREATED')
      .first();

    if (!notificationType) {
      return { success: false, error: 'Notification type not found. Run migrations first.' };
    }

    // Create a test notification
    await createNotificationAction({
      user_id: currentUser.user_id,
      type_id: notificationType.internal_notification_type_id,
      title: 'Test Notification',
      message: 'This is a test notification to verify the system is working!',
      data: {
        test: true,
        timestamp: new Date().toISOString()
      },
      action_url: '/msp/dashboard'
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to create test notification:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Create multiple test notifications to verify the system
 */
export async function createMultipleTestNotificationsAction(): Promise<{ success: boolean; error?: string; count?: number }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const currentUser = await getCurrentUser();

    if (!tenant || !currentUser) {
      return { success: false, error: 'Authentication required' };
    }

    // Get different notification types
    const notificationTypes = await knex('internal_notification_types')
      .whereIn('type_name', ['TICKET_CREATED', 'TICKET_ASSIGNED', 'PROJECT_TASK_ASSIGNED', 'USER_MENTIONED'])
      .select();

    if (notificationTypes.length === 0) {
      return { success: false, error: 'No notification types found. Run migrations first.' };
    }

    const testNotifications = [
      {
        type_name: 'TICKET_CREATED',
        title: 'New Ticket Created',
        message: 'A new support ticket has been created and requires attention.',
        action_url: '/msp/tickets/test-1'
      },
      {
        type_name: 'TICKET_ASSIGNED',
        title: 'Ticket Assigned to You',
        message: 'You have been assigned a new ticket that needs your attention.',
        action_url: '/msp/tickets/test-2'
      },
      {
        type_name: 'PROJECT_TASK_ASSIGNED',
        title: 'New Task Assignment',
        message: 'You have been assigned a new task in the AlgaPSA project.',
        action_url: '/msp/projects/test-1'
      },
      {
        type_name: 'USER_MENTIONED',
        title: 'You Were Mentioned',
        message: 'Someone mentioned you in a ticket comment.',
        action_url: '/msp/tickets/test-3'
      }
    ];

    let count = 0;
    for (const notification of testNotifications) {
      const notificationType = notificationTypes.find(nt => nt.type_name === notification.type_name);
      if (notificationType) {
        await createNotificationAction({
          user_id: currentUser.user_id,
          type_id: notificationType.internal_notification_type_id,
          title: notification.title,
          message: notification.message,
          data: {
            test: true,
            created_at: new Date().toISOString()
          },
          action_url: notification.action_url
        });
        count++;
      }
    }

    return { success: true, count };
  } catch (error) {
    console.error('Failed to create test notifications:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}