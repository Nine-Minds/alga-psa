'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';
import { getEventBus } from 'server/src/lib/eventBus';

/**
 * Force re-register notification subscriber and test immediately
 */
export async function forceRegisterAndTestNotifications() {
  try {
    console.log('🔄 Force registering notification subscriber...');
    
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User not authenticated');
    }
    const { knex, tenant } = await createTenantKnex();
    
    // Get the EXACT same EventBus instance used by the system
    const eventBus = getEventBus();
    console.log('✅ Got EventBus instance');
    
    // Clear existing handlers first
    const handlers = (eventBus as any).handlers;
    console.log('📋 Current handlers before clear:', Array.from(handlers.keys()));
    
    // Force re-registration
    const { registerNotificationSubscriber } = await import('../../eventBus/subscribers/notificationSubscriber');
    await registerNotificationSubscriber();
    console.log('✅ Re-registered notification subscriber');
    
    // Check handlers after registration
    console.log('📋 Handlers after re-registration:', {
      eventTypes: Array.from(handlers.keys()),
      totalHandlers: Array.from(handlers.values()).reduce((sum: number, set: any) => sum + set.size, 0),
      ticketAssignedHandlers: handlers.get('TICKET_ASSIGNED')?.size || 0
    });
    
    // Create a test ticket
    const [ticket] = await knex('tickets').insert({
      tenant,
      ticket_number: `FORCE-${Date.now()}`,
      title: 'Force Registration Test',
      assigned_to: user.user_id,
      entered_by: user.user_id,
      entered_at: new Date(),
      updated_at: new Date(),
      is_closed: false
    }).returning('*');
    
    console.log('🎫 Created test ticket:', ticket.ticket_id);
    
    // IMMEDIATELY publish event to the SAME EventBus instance
    console.log('📡 Publishing event to the same EventBus instance...');
    await eventBus.publish({
      eventType: 'TICKET_ASSIGNED',
      payload: {
        tenantId: tenant,
        ticketId: ticket.ticket_id,
        userId: user.user_id,
        timestamp: new Date().toISOString()
      },
      tenantId: tenant
    });
    
    console.log('✅ Event published to same EventBus instance');
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check for notifications
    const notifications = await knex('internal_notifications')
      .where('user_id', user.user_id)
      .where('created_at', '>=', new Date(Date.now() - 3 * 60 * 1000))
      .orderBy('created_at', 'desc');
    
    console.log(`📋 Found ${notifications.length} notifications after forced registration`);
    
    return {
      success: true,
      data: {
        ticketCreated: ticket.ticket_id,
        handlersRegistered: Array.from(handlers.keys()).length,
        ticketAssignedHandlers: handlers.get('TICKET_ASSIGNED')?.size || 0,
        notificationsFound: notifications.length,
        notifications: notifications.map(notif => ({
          title: notif.title,
          message: notif.message,
          createdAt: notif.created_at
        }))
      }
    };
    
  } catch (error) {
    console.error('❌ Force registration test failed:', error);
    return {
      success: false,
      error: (error as Error).message,
      stack: (error as Error).stack
    };
  }
}