'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';
import { getEventBus } from 'server/src/lib/eventBus';

/**
 * Debug action to manually test the notification system
 */
export async function debugNotificationSystem() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // 1. Check if notification types exist
    const notificationTypes = await knex('internal_notification_types').select('*');
    console.log('✅ Notification types found:', notificationTypes.length);
    
    // 2. Check if templates exist
    const templates = await knex('internal_notification_templates').select('*');
    console.log('✅ Notification templates found:', templates.length);
    
    // 3. Check Redis connection
    let redisStatus = 'UNKNOWN';
    try {
      const Redis = require('ioredis');
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
      });
      await redis.ping();
      redisStatus = 'CONNECTED';
      redis.disconnect();
    } catch (redisError) {
      redisStatus = `ERROR: ${(redisError as Error).message}`;
    }
    console.log('🔗 Redis status:', redisStatus);
    
    // 4. Test event publishing
    console.log('🚀 Publishing test TICKET_ASSIGNED event...');
    let eventPublishStatus = 'SUCCESS';
    try {
      await getEventBus().publish({
        eventType: 'TICKET_ASSIGNED',
        payload: {
          ticketId: 'test-ticket-123',
          assignedTo: user.user_id,
          assignedBy: user.user_id,
          timestamp: new Date().toISOString()
        },
        tenantId: tenant // Add tenant to event
      });
    } catch (eventError) {
      eventPublishStatus = `ERROR: ${(eventError as Error).message}`;
    }
    
    // 5. Wait a moment for async processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 6. Check if notifications were created
    const allNotifications = await knex('internal_notifications')
      .where('user_id', user.user_id)
      .orderBy('created_at', 'desc')
      .limit(10);
    
    const recentNotifications = await knex('internal_notifications')
      .where('user_id', user.user_id)
      .where('created_at', '>=', new Date(Date.now() - 5 * 60 * 1000)) // Last 5 minutes
      .orderBy('created_at', 'desc');
    
    console.log('📝 All recent notifications for user:', allNotifications.length);
    console.log('📝 Notifications in last 5 minutes:', recentNotifications.length);
    
    // 7. Check event bus status
    let eventBusStatus = 'UNKNOWN';
    try {
      const eventBus = getEventBus();
      eventBusStatus = 'INITIALIZED';
    } catch (eventBusError) {
      eventBusStatus = `ERROR: ${(eventBusError as Error).message}`;
    }
    
    return {
      success: true,
      data: {
        userId: user.user_id,
        tenant,
        notificationTypes: notificationTypes.length,
        templates: templates.length,
        redisStatus,
        eventBusStatus,
        eventPublishStatus,
        allNotifications: allNotifications.length,
        recentNotifications: recentNotifications.length,
        notifications: recentNotifications
      }
    };
    
  } catch (error) {
    console.error('❌ Debug notification system failed:', error);
    return {
      success: false,
      error: (error as Error).message,
      stack: (error as Error).stack
    };
  }
}

/**
 * Create a test notification directly (bypass event system)
 */
export async function createTestNotification() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // Get a notification type
    const ticketType = await knex('internal_notification_types')
      .where('type_name', 'TICKET_ASSIGNED')
      .first();
    
    if (!ticketType) {
      throw new Error('TICKET_ASSIGNED notification type not found');
    }
    
    // Get a priority
    const priority = await knex('standard_priorities')
      .where('priority_name', 'Normal')
      .first();
    
    // Create test notification
    const notification = {
      tenant,
      user_id: user.user_id,
      type_id: ticketType.internal_notification_type_id,
      title: 'Test Notification - Manual Creation',
      message: 'This is a test notification created manually to debug the system.',
      data: {
        ticket_id: 'test-123',
        ticket_number: 'TEST-001',
        ticket_title: 'Debug Test Ticket'
      },
      action_url: '/msp/tickets/test-123',
      priority_id: priority?.priority_id || null,
      created_at: new Date()
    };
    
    await knex('internal_notifications').insert(notification);
    
    console.log('✅ Test notification created directly in database');
    
    return {
      success: true,
      message: 'Test notification created successfully'
    };
    
  } catch (error) {
    console.error('❌ Create test notification failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check current user's notification preferences
 */
export async function checkNotificationPreferences() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const preferences = await knex('internal_notification_preferences')
      .where('tenant', tenant)
      .where('user_id', user.user_id)
      .join('internal_notification_types', 'internal_notification_preferences.internal_notification_type_id', 'internal_notification_types.internal_notification_type_id');
    
    // Check if notification permissions exist
    const notificationPermissions = await knex('permissions')
      .where('permission_name', 'like', 'notification:%')
      .select('permission_name', 'description');
    
    // Check user's roles and permissions
    const userRoles = await knex('user_roles')
      .where('tenant', tenant)
      .where('user_id', user.user_id)
      .join('roles', 'user_roles.role_id', 'roles.role_id')
      .select('roles.role_name', 'roles.role_id');
    
    // Check if user has notification permissions
    const userPermissions = await knex('role_permissions')
      .whereIn('role_id', userRoles.map(r => r.role_id))
      .join('permissions', 'role_permissions.permission_id', 'permissions.permission_id')
      .where('permissions.permission_name', 'like', 'notification:%')
      .select('permissions.permission_name', 'role_permissions.can_read', 'role_permissions.can_write');
    
    console.log('🔧 User notification preferences:', preferences.length);
    console.log('🔑 Notification permissions in system:', notificationPermissions.length);
    console.log('👤 User roles:', userRoles.length);
    console.log('🛡️ User notification permissions:', userPermissions.length);
    
    return {
      success: true,
      data: {
        preferences,
        systemPermissions: notificationPermissions,
        userRoles,
        userPermissions
      }
    };
    
  } catch (error) {
    console.error('❌ Check preferences failed:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}