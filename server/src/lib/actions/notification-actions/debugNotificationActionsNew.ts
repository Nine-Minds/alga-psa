'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';
import { getEventBus } from 'server/src/lib/eventBus';

/**
 * Comprehensive test for notification subscriber registration
 */
export async function testNotificationSubscriberRegistrationDetailed() {
  try {
    console.log('🔧 Testing notification subscriber registration...');
    
    // Get EventBus instance
    const eventBus = getEventBus();
    console.log('✅ EventBus instance obtained');
    
    // Check current handlers before registration
    const beforeHandlers = (eventBus as any).handlers;
    console.log('📋 Handlers before registration:', {
      totalEventTypes: Array.from(beforeHandlers.keys()),
      totalHandlerCount: Array.from(beforeHandlers.values()).reduce((sum: number, set: any) => sum + set.size, 0)
    });
    
    // Force initialization
    await eventBus.initialize();
    console.log('✅ EventBus initialized');
    
    // Import and test notification subscriber step by step
    console.log('📥 Importing notification subscriber module...');
    const notificationModule = await import('../../eventBus/subscribers/notificationSubscriber');
    console.log('✅ Notification subscriber module imported');
    
    // Check what's available in the module
    console.log('🔍 Available exports in notification module:', Object.keys(notificationModule));
    
    // Get the registration function
    const { registerNotificationSubscriber, handleNotificationEvent } = notificationModule;
    console.log('✅ Registration function available:', !!registerNotificationSubscriber);
    console.log('✅ Handler function available:', !!handleNotificationEvent);
    
    // Test manual subscription first
    console.log('🔄 Testing manual subscription to TICKET_ASSIGNED...');
    try {
      await eventBus.subscribe('TICKET_ASSIGNED', handleNotificationEvent);
      console.log('✅ Manual subscription successful');
    } catch (subscribeError) {
      console.log('❌ Manual subscription failed:', (subscribeError as Error).message);
    }
    
    // Check handlers after manual subscription
    const afterManualHandlers = (eventBus as any).handlers;
    console.log('📋 Handlers after manual subscription:', {
      totalEventTypes: Array.from(afterManualHandlers.keys()),
      totalHandlerCount: Array.from(afterManualHandlers.values()).reduce((sum: number, set: any) => sum + set.size, 0),
      ticketAssignedHandlers: afterManualHandlers.get('TICKET_ASSIGNED')?.size || 0
    });
    
    // Now try the full registration function
    console.log('🔄 Calling full registerNotificationSubscriber()...');
    try {
      await registerNotificationSubscriber();
      console.log('✅ Called registerNotificationSubscriber() successfully');
    } catch (regError) {
      console.log('❌ registerNotificationSubscriber() failed:', (regError as Error).message);
      console.log('Stack:', (regError as Error).stack);
    }
    
    // Check handlers after full registration
    const afterRegistration = (eventBus as any).handlers;
    console.log('📋 Handlers after full registration:', {
      totalEventTypes: Array.from(afterRegistration.keys()),
      totalHandlerCount: Array.from(afterRegistration.values()).reduce((sum: number, set: any) => sum + set.size, 0),
      ticketAssignedHandlers: afterRegistration.get('TICKET_ASSIGNED')?.size || 0,
      ticketCreatedHandlers: afterRegistration.get('TICKET_CREATED')?.size || 0,
      allEventTypes: Array.from(afterRegistration.keys())
    });
    
    // Test event publication and processing
    console.log('🚀 Testing event publication with registered handlers...');
    const user = await getCurrentUser();
    if (user) {
      const { knex, tenant } = await createTenantKnex();
      
      // Create test ticket
      const [ticket] = await knex('tickets').insert({
        tenant,
        ticket_number: `REG-${Date.now()}`,
        title: 'Test Registration Flow',
        assigned_to: user.user_id,
        entered_by: user.user_id,
        entered_at: new Date(),
        updated_at: new Date(),
        is_closed: false
      }).returning('*');
      
      // Publish test event
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
      
      console.log('✅ Test event published');
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check for notifications
      const notifications = await knex('internal_notifications')
        .where('user_id', user.user_id)
        .where('created_at', '>=', new Date(Date.now() - 2 * 60 * 1000))
        .orderBy('created_at', 'desc');
      
      console.log(`📋 Found ${notifications.length} notifications after registration test`);
    }
    
    return {
      success: true,
      data: {
        moduleExports: Object.keys(notificationModule),
        beforeRegistration: {
          eventTypes: Array.from(beforeHandlers.keys()),
          totalHandlers: Array.from(beforeHandlers.values()).reduce((sum: number, set: any) => sum + set.size, 0)
        },
        afterManualSubscription: {
          eventTypes: Array.from(afterManualHandlers.keys()),
          totalHandlers: Array.from(afterManualHandlers.values()).reduce((sum: number, set: any) => sum + set.size, 0),
          ticketAssignedHandlers: afterManualHandlers.get('TICKET_ASSIGNED')?.size || 0
        },
        afterFullRegistration: {
          eventTypes: Array.from(afterRegistration.keys()),
          totalHandlers: Array.from(afterRegistration.values()).reduce((sum: number, set: any) => sum + set.size, 0),
          ticketAssignedHandlers: afterRegistration.get('TICKET_ASSIGNED')?.size || 0
        }
      }
    };
    
  } catch (error) {
    console.error('❌ Notification subscriber registration test failed:', error);
    return {
      success: false,
      error: (error as Error).message,
      stack: (error as Error).stack
    };
  }
}