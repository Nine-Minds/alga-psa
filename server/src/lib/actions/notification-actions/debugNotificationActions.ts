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
      error: (error as Error).message
    };
  }
}

/**
 * Test if ticket assignment events are being published and received
 */
export async function testTicketAssignmentFlow() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // Use the actual ticket creation function to ensure proper event publishing
    const { addTicket } = await import('server/src/lib/actions/ticket-actions/ticketActions');
    
    // Get required IDs for ticket creation (use the actual functions from the app)
    const { getTicketStatuses } = await import('server/src/lib/actions/status-actions/statusActions');
    const { getAllPrioritiesWithStandard } = await import('server/src/lib/actions/priorityActions');
    const { getAllChannels } = await import('server/src/lib/actions/channel-actions/channelActions');
    const { getAllCompanies } = await import('server/src/lib/actions/company-actions/companyActions');
    
    const [statuses, priorities, channels, companies] = await Promise.all([
      getTicketStatuses(),
      getAllPrioritiesWithStandard('ticket'),
      getAllChannels(),
      getAllCompanies(false) // false = include inactive companies
    ]);
    
    const defaultStatus = statuses.find(s => s.is_default) || statuses[0];
    const defaultPriority = priorities.find(p => 'is_default' in p && p.is_default) || priorities[0];
    const defaultChannel = channels[0];
    const defaultCompany = companies[0];
    
    if (!defaultStatus || !defaultPriority || !defaultChannel || !defaultCompany) {
      throw new Error('Missing required ticket defaults (status, priority, channel, or company)');
    }
    
    console.log('🎫 Creating ticket using actual addTicket function...');
    
    // Create FormData as expected by addTicket function
    const formData = new FormData();
    formData.append('title', 'Test Ticket Assignment Flow');
    formData.append('description', 'This is a test ticket created to verify that notifications work when tickets are assigned to users.');
    formData.append('ticket_number', `FLOW-${Date.now()}`);
    formData.append('url', '');
    formData.append('status_id', defaultStatus.status_id);
    formData.append('priority_id', 'priority_id' in defaultPriority ? defaultPriority.priority_id : (defaultPriority as any).standard_priority_id);
    formData.append('channel_id', defaultChannel.channel_id || '');
    formData.append('company_id', defaultCompany.company_id || '');
    formData.append('assigned_to', user.user_id); // Assign to current user immediately
    formData.append('attributes', JSON.stringify({}));
    
    const ticket = await addTicket(formData, user);
    if (!ticket) {
      throw new Error('Failed to create ticket');
    }
    console.log('✅ Created and assigned ticket:', ticket.ticket_id);
    
    console.log('⏳ Waiting for event processing...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check if notification was created
    const notifications = await knex('internal_notifications')
      .where('user_id', user.user_id)
      .where('created_at', '>=', new Date(Date.now() - 2 * 60 * 1000)) // Last 2 minutes
      .orderBy('created_at', 'desc');
    
    console.log('🎯 Assignment flow test completed');
    
    return {
      success: true,
      data: {
        ticket: {
          id: ticket.ticket_id,
          number: ticket.ticket_number,
          assignedTo: ticket.assigned_to,
          assignmentWorked: ticket.assigned_to === user.user_id
        },
        notifications: {
          found: notifications.length,
          details: notifications.map(notif => ({
            id: notif.notification_id,
            title: notif.title,
            message: notif.message,
            createdAt: notif.created_at,
            data: typeof notif.data === 'string' ? JSON.parse(notif.data) : notif.data
          }))
        }
      }
    };
    
  } catch (error) {
    console.error('❌ Ticket assignment flow test failed:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Test notification handler directly (bypass EventBus registration)
 */
export async function testNotificationHandlerDirectly() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { tenant } = await createTenantKnex();
  
  try {
    console.log('🔧 Testing notification handler directly...');
    
    // Import the handler function directly
    const notificationModule = await import('../../eventBus/subscribers/notificationSubscriber');
    
    // First create a real ticket in the database
    const { knex } = await createTenantKnex();
    const { v4: uuidv4 } = await import('uuid');
    
    const [ticket] = await knex('tickets').insert({
      tenant,
      ticket_number: `TEST-${Date.now()}`,
      title: 'Test Handler Direct Call',
      assigned_to: user.user_id, // Assign to current user
      entered_by: user.user_id,
      entered_at: new Date(),
      updated_at: new Date(),
      is_closed: false
    }).returning('*');
    
    console.log('🎫 Created test ticket:', ticket.ticket_id, 'assigned to:', ticket.assigned_to);
    
    // Create a test event with the real ticket ID
    const testEvent = {
      id: uuidv4(),
      eventType: 'TICKET_ASSIGNED' as any,
      timestamp: new Date().toISOString(),
      payload: {
        tenantId: tenant,
        ticketId: ticket.ticket_id,
        userId: user.user_id,
        timestamp: new Date().toISOString()
      },
      tenantId: tenant
    };
    
    console.log('📤 Calling notification handler directly with test event...');
    
    // Call the handler directly - access private function via reflection
    const handleNotificationEvent = (notificationModule as any).handleNotificationEvent;
    if (handleNotificationEvent) {
      await handleNotificationEvent(testEvent);
      console.log('✅ Handler called successfully');
    } else {
      console.log('❌ Handler function not found');
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check for notifications (reuse existing knex connection)
    const notifications = await knex('internal_notifications')
      .where('user_id', user.user_id)
      .where('created_at', '>=', new Date(Date.now() - 2 * 60 * 1000))
      .orderBy('created_at', 'desc');
    
    console.log(`📋 Found ${notifications.length} notifications after direct handler call`);
    
    // Debug: Check what handlers are actually registered in EventBus
    const eventBus = getEventBus();
    const reflection = (eventBus as any);
    console.log('🔍 EventBus handlers registered:', {
      totalHandlerTypes: Array.from(reflection.handlers.keys()),
      ticketAssignedHandlers: reflection.handlers.get('TICKET_ASSIGNED')?.size || 0,
      emailHandlers: reflection.handlers.get('TICKET_CREATED')?.size || 0,
      allHandlerSizes: Array.from(reflection.handlers.entries()).map(([key, value]) => ({ eventType: key, handlerCount: value.size }))
    });
    
    return {
      success: true,
      data: {
        handlerExists: !!handleNotificationEvent,
        handlerCalled: true,
        notificationsFound: notifications.length,
        notifications: notifications.map(notif => ({
          id: notif.notification_id,
          title: notif.title,
          message: notif.message,
          createdAt: notif.created_at
        }))
      }
    };
    
  } catch (error) {
    console.error('❌ Direct handler test failed:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Enhanced debug to trace notification flow step by step
 */
export async function traceNotificationFlow() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    console.log('🔍 Starting notification flow trace...');
    
    // 0. Check EventBus Redis connection status
    console.log('🔗 Step 0: Checking EventBus Redis connection...');
    const eventBus = getEventBus();
    await eventBus.initialize(); // Force initialization
    
    // 0.5. Manually register notification subscriber
    console.log('📝 Step 0.5: Registering notification subscriber...');
    try {
      console.log('🔄 Importing notification subscriber...');
      const { registerNotificationSubscriber } = await import('../../eventBus/subscribers/notificationSubscriber');
      console.log('✅ Import successful, calling registration...');
      await registerNotificationSubscriber();
      console.log('✅ Notification subscriber registration completed');
    } catch (regError: unknown) {
      console.error('❌ Notification subscriber registration failed:', regError);
      if (regError instanceof Error) {
        console.error('Stack:', regError.stack);
      }
    }
    
    // 1. Test direct event publishing
    console.log('📡 Step 1: Publishing TICKET_ASSIGNED event directly...');
    const { v4: uuidv4 } = await import('uuid');
    await getEventBus().publish({
      eventType: 'TICKET_ASSIGNED',
      payload: {
        tenantId: tenant,
        ticketId: uuidv4(), // Use proper UUID
        userId: user.user_id,
        timestamp: new Date().toISOString()
      },
      tenantId: tenant
    });
    
    // 1.5. Check if handlers are registered
    console.log('🔍 Step 1.5: Checking registered handlers...');
    const eventBusReflection = (eventBus as any);
    const handlers = eventBusReflection.handlers;
    console.log('📋 Registered handlers:', {
      handlerKeys: Array.from(handlers.keys()),
      ticketAssignedHandlers: handlers.get('TICKET_ASSIGNED')?.size || 0
    });
    
    console.log('⏳ Waiting 2 seconds for event processing...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 2. Check if notification was created
    const notifications = await knex('internal_notifications')
      .where('user_id', user.user_id)
      .where('created_at', '>=', new Date(Date.now() - 2 * 60 * 1000))
      .orderBy('created_at', 'desc');
    
    console.log(`📋 Found ${notifications.length} notifications in database`);
    
    // 3. Check Redis streams for events
    console.log('🔍 Step 2: Checking Redis streams...');
    let redisEvents = [];
    try {
      const Redis = require('ioredis');
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
      });
      
      // Check both stream types
      const ticketStream = 'alga-psa:event-stream:TICKET_ASSIGNED';
      const workflowStream = 'workflow:events:global';
      
      try {
        const ticketEvents = await redis.xrevrange(ticketStream, '+', '-', 'COUNT', 5);
        const workflowEvents = await redis.xrevrange(workflowStream, '+', '-', 'COUNT', 5);
        
        console.log(`📡 Ticket stream events: ${ticketEvents.length}`);
        console.log(`🔄 Workflow stream events: ${workflowEvents.length}`);
        
        redisEvents = [...ticketEvents, ...workflowEvents];
      } catch (streamError: unknown) {
        const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
        console.log('❌ Error reading streams:', errorMessage);
      }
      
      redis.disconnect();
    } catch (redisError: unknown) {
      const errorMessage = redisError instanceof Error ? redisError.message : String(redisError);
      console.log('❌ Redis connection error:', errorMessage);
    }
    
    // 4. Check notification types and templates
    const notificationTypes = await knex('internal_notification_types')
      .where('type_name', 'TICKET_ASSIGNED')
      .first();
    
    const notificationTemplates = await knex('internal_notification_templates')
      .where('type_id', notificationTypes?.internal_notification_type_id)
      .first();
    
    console.log('🔍 Step 3: Notification system components...');
    console.log(`📝 TICKET_ASSIGNED type exists: ${!!notificationTypes}`);
    console.log(`📄 Template exists: ${!!notificationTemplates}`);
    
    // 5. Check user permissions for notification
    const userPermissions = await knex('user_roles as ur')
      .join('roles as r', 'ur.role_id', 'r.role_id')
      .join('role_permissions as rp', 'r.role_id', 'rp.role_id')
      .join('permissions as p', 'rp.permission_id', 'p.permission_id')
      .where('ur.user_id', user.user_id)
      .where('ur.tenant', tenant)
      .select('p.resource', 'p.action');
    
    console.log(`🛡️ User has ${userPermissions.length} permissions`);
    
    return {
      success: true,
      data: {
        eventPublished: true,
        notificationsFound: notifications.length,
        redisEventsFound: redisEvents.length,
        notificationTypeExists: !!notificationTypes,
        templateExists: !!notificationTemplates,
        userPermissions: userPermissions.length,
        notifications: notifications.map(notif => ({
          id: notif.notification_id,
          title: notif.title,
          message: notif.message,
          createdAt: notif.created_at,
          data: typeof notif.data === 'string' ? JSON.parse(notif.data) : notif.data
        }))
      }
    };
    
  } catch (error) {
    console.error('❌ Notification flow trace failed:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Test EventBus initialization and connection
 */
export async function testEventBusConnection() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User not authenticated');
    }

    const { tenant } = await createTenantKnex();
    const eventBus = getEventBus();
    
    // Try to get the internal Redis connection status
    const reflection = (eventBus as any);
    console.log('🔄 EventBus instance exists:', !!eventBus);
    console.log('🔄 EventBus initialized:', reflection.initialized);
    
    // Test Redis connection directly first
    let directRedisStatus = 'UNKNOWN';
    try {
      const Redis = require('ioredis');
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
      });
      await redis.ping();
      directRedisStatus = 'CONNECTED';
      redis.disconnect();
    } catch (redisError) {
      directRedisStatus = `ERROR: ${(redisError as Error).message}`;
    }
    console.log('🔗 Direct Redis connection status:', directRedisStatus);
    
    // Test EventBus initialization
    try {
      await eventBus.initialize();
      console.log('✅ EventBus initialization: SUCCESS');
    } catch (initError) {
      console.log('❌ EventBus initialization: FAILED -', (initError as Error).message);
      return {
        success: false,
        error: `EventBus initialization failed: ${(initError as Error).message}`,
        data: {
          eventBusExists: !!eventBus,
          eventBusInitialized: reflection.initialized,
          directRedisStatus
        }
      };
    }
    
    // Test if we can actually publish an event
    try {
      await eventBus.publish({
        eventType: 'TICKET_CREATED',
        payload: {
          tenantId: tenant,
          ticketId: 'test-ticket-123',
          userId: user.user_id,
          title: 'Test Ticket from EventBus Connection Test'
        }
      });
      console.log('✅ Event publishing test: SUCCESS');
      
      return {
        success: true,
        message: 'EventBus connection and publishing are working',
        data: {
          eventBusExists: !!eventBus,
          eventBusInitialized: reflection.initialized,
          directRedisStatus,
          publishingWorks: true
        }
      };
    } catch (publishError) {
      console.log('❌ Event publishing test: FAILED -', (publishError as Error).message);
      return {
        success: false,
        error: `Event publishing failed: ${(publishError as Error).message}`,
        data: {
          eventBusExists: !!eventBus,
          eventBusInitialized: reflection.initialized,
          directRedisStatus,
          publishingWorks: false
        }
      };
    }
    
  } catch (error) {
    console.error('❌ EventBus connection test failed:', error);
    return {
      success: false,
      error: (error as Error).message
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
    
    // Check available permissions that we're using for notifications
    const ticketPermissions = await knex('permissions')
      .where('resource', 'ticket')
      .select('resource', 'action');
    
    const projectPermissions = await knex('permissions')
      .where('resource', 'project')
      .select('resource', 'action');
    
    const billingPermissions = await knex('permissions')
      .where('resource', 'billing')
      .select('resource', 'action');
    
    // Check user's roles and permissions
    const userRoles = await knex('user_roles')
      .where('user_roles.tenant', tenant)
      .where('user_roles.user_id', user.user_id)
      .join('roles', 'user_roles.role_id', 'roles.role_id')
      .select('roles.role_name', 'roles.role_id');
    
    // Check if user has the permissions needed for notifications
    let userPermissions: Array<{resource: string, action: string}> = [];
    if (userRoles.length > 0) {
      userPermissions = await knex('role_permissions')
        .whereIn('role_id', userRoles.map(r => r.role_id))
        .join('permissions', 'role_permissions.permission_id', 'permissions.permission_id')
        .whereIn('permissions.resource', ['ticket', 'project', 'billing', 'user'])
        .select('permissions.resource', 'permissions.action');
    }
    
    console.log('🔧 User notification preferences:', preferences.length);
    console.log('🎫 Ticket permissions available:', ticketPermissions.length);
    console.log('📁 Project permissions available:', projectPermissions.length);
    console.log('💰 Billing permissions available:', billingPermissions.length);
    console.log('👤 User roles:', userRoles.length);
    console.log('🛡️ User permissions:', userPermissions.length);
    
    return {
      success: true,
      data: {
        preferences,
        ticketPermissions,
        projectPermissions,
        billingPermissions,
        userRoles,
        userPermissions: userPermissions.length
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

/**
 * Get all notifications for the current user (for AI testing visibility)
 */
/**
 * Test notification subscriber registration
 */
/**
 * Test EventBus initialization and publish
 */
export async function testEventBusInitialization() {
  try {
    console.log('🚀 Testing EventBus initialization and publishing...');
    
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User not authenticated');
    }
    const { knex, tenant } = await createTenantKnex();
    
    // Create a real ticket first
    const { v4: uuidv4 } = await import('uuid');
    const [ticket] = await knex('tickets').insert({
      tenant,
      ticket_number: `INIT-${Date.now()}`,
      title: 'Test EventBus Initialization',
      assigned_to: user.user_id,
      entered_by: user.user_id,
      entered_at: new Date(),
      updated_at: new Date(),
      is_closed: false
    }).returning('*');
    
    console.log('🎫 Created test ticket:', ticket.ticket_id);
    
    // Get EventBus and test publishing
    const eventBus = getEventBus();
    console.log('✅ EventBus instance obtained');
    
    // Try to publish an event (this should trigger initialization)
    console.log('📡 Publishing TICKET_ASSIGNED event...');
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
    
    console.log('✅ Event published successfully!');
    
    // Check if handlers are registered
    const handlers = (eventBus as any).handlers;
    console.log('📋 EventBus handlers after publish:', {
      totalEventTypes: Array.from(handlers.keys()),
      totalHandlerCount: Array.from(handlers.values()).reduce((sum: number, set: any) => sum + set.size, 0)
    });
    
    // Wait a moment for processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check for notifications
    const notifications = await knex('internal_notifications')
      .where('user_id', user.user_id)
      .where('created_at', '>=', new Date(Date.now() - 2 * 60 * 1000))
      .orderBy('created_at', 'desc');
    
    console.log(`📋 Found ${notifications.length} notifications after EventBus publish`);
    
    return {
      success: true,
      data: {
        ticketCreated: ticket.ticket_id,
        eventPublished: true,
        handlersRegistered: Array.from(handlers.keys()).length,
        notificationsFound: notifications.length,
        notifications: notifications.map(notif => ({
          title: notif.title,
          message: notif.message,
          createdAt: notif.created_at
        }))
      }
    };
    
  } catch (error) {
    console.error('❌ EventBus initialization test failed:', error);
    return {
      success: false,
      error: (error as Error).message,
      stack: (error as Error).stack
    };
  }
}

export async function testNotificationSubscriberRegistration() {
  try {
    console.log('🔧 Testing notification subscriber registration...');
    
    // Get EventBus instance
    const eventBus = getEventBus();
    console.log('✅ EventBus instance obtained');
    
    // Check current handlers before registration
    const beforeHandlers = (eventBus as any).handlers;
    console.log('📋 Handlers before registration:', {
      totalEventTypes: Array.from(beforeHandlers.keys()),
      totalHandlerCount: Array.from(beforeHandlers.values()).reduce((sum, set) => sum + set.size, 0)
    });
    
    // Force initialization
    await eventBus.initialize();
    console.log('✅ EventBus initialized');
    
    // Try to register notification subscriber
    const { registerNotificationSubscriber } = await import('../../eventBus/subscribers/notificationSubscriber');
    console.log('✅ Imported notification subscriber registration function');
    
    await registerNotificationSubscriber();
    console.log('✅ Called registerNotificationSubscriber()');
    
    // Check handlers after registration
    const afterHandlers = (eventBus as any).handlers;
    console.log('📋 Handlers after registration:', {
      totalEventTypes: Array.from(afterHandlers.keys()),
      totalHandlerCount: Array.from(afterHandlers.values()).reduce((sum, set) => sum + set.size, 0),
      ticketAssignedHandlers: afterHandlers.get('TICKET_ASSIGNED')?.size || 0,
      ticketCreatedHandlers: afterHandlers.get('TICKET_CREATED')?.size || 0
    });
    
    // Compare with email subscriber registration for comparison
    try {
      const { registerTicketEmailSubscriber } = await import('../../eventBus/subscribers/ticketEmailSubscriber');
      console.log('✅ Imported ticket email subscriber registration');
      
      await registerTicketEmailSubscriber();
      console.log('✅ Called registerTicketEmailSubscriber()');
      
      const withEmailHandlers = (eventBus as any).handlers;
      console.log('📋 Handlers after email registration:', {
        totalEventTypes: Array.from(withEmailHandlers.keys()),
        totalHandlerCount: Array.from(withEmailHandlers.values()).reduce((sum, set) => sum + set.size, 0),
        ticketAssignedHandlers: withEmailHandlers.get('TICKET_ASSIGNED')?.size || 0,
        ticketCreatedHandlers: withEmailHandlers.get('TICKET_CREATED')?.size || 0
      });
      
    } catch (emailError) {
      console.log('❌ Error with email subscriber:', emailError.message);
    }
    
    return {
      success: true,
      data: {
        beforeRegistration: {
          eventTypes: Array.from(beforeHandlers.keys()),
          totalHandlers: Array.from(beforeHandlers.values()).reduce((sum, set) => sum + set.size, 0)
        },
        afterRegistration: {
          eventTypes: Array.from(afterHandlers.keys()),
          totalHandlers: Array.from(afterHandlers.values()).reduce((sum, set) => sum + set.size, 0),
          ticketAssignedHandlers: afterHandlers.get('TICKET_ASSIGNED')?.size || 0
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

export async function getAllUserNotifications(limit: number = 50) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const notifications = await knex('internal_notifications as n')
      .leftJoin('internal_notification_types as nt', 'n.type_id', 'nt.internal_notification_type_id')
      .leftJoin('standard_priorities as p', 'n.priority_id', 'p.priority_id')
      .where('n.tenant', tenant)
      .where('n.user_id', user.user_id)
      .orderBy('n.created_at', 'desc')
      .limit(limit)
      .select(
        'n.*',
        'nt.type_name',
        'nt.description as type_description',
        'p.priority_name'
      );
    
    console.log(`📋 Retrieved ${notifications.length} notifications for user ${user.user_id}`);
    
    return {
      success: true,
      data: {
        userId: user.user_id,
        tenant,
        totalNotifications: notifications.length,
        notifications: notifications.map(notif => ({
          ...notif,
          data: typeof notif.data === 'string' ? JSON.parse(notif.data) : notif.data
        }))
      }
    };
    
  } catch (error) {
    console.error('❌ Get all notifications failed:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Get recent notification events from Redis streams (for AI testing visibility)
 */
export async function getRecentNotificationEvents(eventType?: string, limit: number = 20) {
  try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
    });
    
    const events = [];
    const eventTypes = eventType ? [eventType] : ['TICKET_CREATED', 'TICKET_ASSIGNED', 'PROJECT_CREATED', 'PROJECT_TASK_ASSIGNED'];
    
    for (const type of eventTypes) {
      const streamName = `alga-psa:event-stream:${type}`;
      try {
        const streamEvents = await redis.xRevRange(streamName, '+', '-', 'COUNT', limit);
        for (const [id, fields] of streamEvents) {
          const event = JSON.parse(fields[1]); // fields[0] is 'event', fields[1] is the JSON
          events.push({
            streamId: id,
            streamName,
            eventType: type,
            timestamp: event.timestamp,
            eventData: event
          });
        }
      } catch (streamError) {
        console.log(`Stream ${streamName} not found or empty`);
      }
    }
    
    redis.disconnect();
    
    // Sort by timestamp desc
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    console.log(`📡 Retrieved ${events.length} recent events from Redis streams`);
    
    return {
      success: true,
      data: {
        totalEvents: events.length,
        searchedEventTypes: eventTypes,
        events: events.slice(0, limit)
      }
    };
    
  } catch (error) {
    console.error('❌ Get recent events failed:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Simulate a real event to test the full notification pipeline (for AI testing)
 */
export async function simulateRealEvent(eventType: 'TICKET_ASSIGNED' | 'TICKET_CREATED' | 'PROJECT_TASK_ASSIGNED' = 'TICKET_ASSIGNED') {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    let simulatedEvent;
    
    if (eventType === 'TICKET_ASSIGNED') {
      // Create a real ticket first
      const [ticket] = await knex('tickets').insert({
        tenant,
        ticket_number: `SIM-${Date.now()}`,
        title: 'AI Test Ticket - Simulated Assignment',
        description: 'This ticket was created for AI-driven notification testing',
        assigned_to: user.user_id,
        entered_by: user.user_id,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      
      simulatedEvent = {
        eventType: 'TICKET_ASSIGNED',
        payload: {
          tenantId: tenant,
          ticketId: ticket.ticket_id,
          assignedTo: user.user_id,
          assignedBy: user.user_id,
          timestamp: new Date().toISOString()
        },
        tenantId: tenant
      };
    } else if (eventType === 'TICKET_CREATED') {
      const [ticket] = await knex('tickets').insert({
        tenant,
        ticket_number: `SIM-${Date.now()}`,
        title: 'AI Test Ticket - Simulated Creation',
        description: 'This ticket was created for AI-driven notification testing',
        entered_by: user.user_id,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      
      simulatedEvent = {
        eventType: 'TICKET_CREATED',
        payload: {
          tenantId: tenant,
          ticketId: ticket.ticket_id,
          userId: user.user_id,
          title: ticket.title,
          timestamp: new Date().toISOString()
        },
        tenantId: tenant
      };
    } else if (eventType === 'PROJECT_TASK_ASSIGNED') {
      // Create a project and task first
      const [project] = await knex('projects').insert({
        tenant,
        project_name: `AI Test Project - ${Date.now()}`,
        description: 'This project was created for AI-driven notification testing',
        created_by: user.user_id,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      
      const [task] = await knex('project_tasks').insert({
        tenant,
        project_id: project.project_id,
        task_name: 'AI Test Task - Simulated Assignment',
        description: 'This task was created for AI-driven notification testing',
        assigned_to: user.user_id,
        created_by: user.user_id,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      
      simulatedEvent = {
        eventType: 'PROJECT_TASK_ASSIGNED',
        payload: {
          tenantId: tenant,
          projectId: project.project_id,
          taskId: task.task_id,
          assignedTo: user.user_id,
          assignedBy: user.user_id,
          timestamp: new Date().toISOString()
        },
        tenantId: tenant
      };
    }
    
    // Publish the event
    if (simulatedEvent) {
      await getEventBus().publish(simulatedEvent);
    } else {
      throw new Error('Failed to create simulated event');
    }
    
    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if notification was created
    const notifications = await knex('internal_notifications')
      .where('user_id', user.user_id)
      .where('created_at', '>=', new Date(Date.now() - 5 * 60 * 1000)) // Last 5 minutes
      .orderBy('created_at', 'desc');
    
    console.log(`🎯 Simulated ${eventType} event and found ${notifications.length} resulting notifications`);
    
    return {
      success: true,
      data: {
        simulatedEvent,
        resultingNotifications: notifications.length,
        notifications: notifications.map(notif => ({
          ...notif,
          data: typeof notif.data === 'string' ? JSON.parse(notif.data) : notif.data
        }))
      }
    };
    
  } catch (error) {
    console.error('❌ Simulate real event failed:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Get notification system status and health check (for AI monitoring)
 */
export async function getNotificationSystemStatus() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // Check database components
    const notificationTypes = await knex('internal_notification_types').count('* as count').first();
    const notificationTemplates = await knex('internal_notification_templates').count('* as count').first();
    const totalNotifications = await knex('internal_notifications').where('tenant', tenant).count('* as count').first();
    const recentNotifications = await knex('internal_notifications')
      .where('tenant', tenant)
      .where('created_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
      .count('* as count').first();
    
    // Check Redis connection
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
    
    // Check EventBus status
    const eventBus = getEventBus();
    const eventBusStatus = {
      exists: !!eventBus,
      initialized: (eventBus as any).initialized || false
    };
    
    console.log('🏥 Notification system health check completed');
    
    return {
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        tenant,
        userId: user.user_id,
        database: {
          notificationTypes: notificationTypes?.count || 0,
          notificationTemplates: notificationTemplates?.count || 0,
          totalNotifications: totalNotifications?.count || 0,
          recentNotifications: recentNotifications?.count || 0
        },
        redis: {
          status: redisStatus,
          connected: redisStatus === 'CONNECTED'
        },
        eventBus: eventBusStatus,
        systemHealthy: redisStatus === 'CONNECTED' && eventBusStatus.initialized
      }
    };
    
  } catch (error) {
    console.error('❌ System status check failed:', error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}