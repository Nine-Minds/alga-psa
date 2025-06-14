/**
 * Testing utility for notification integration
 * This can be used to manually test notification creation via events
 */

import { createNotificationAction } from '../actions/notification-actions/inAppNotificationActions';
import { getEventBus } from '../eventBus';
import { randomUUID } from 'crypto';

export async function testTicketCreatedNotification(ticketId: string, tenantId: string, userId: string) {
  const eventBus = getEventBus();
  
  await eventBus.publish({
    id: randomUUID(),
    eventType: 'TICKET_CREATED',
    timestamp: new Date().toISOString(),
    payload: {
      tenantId,
      ticketId,
      userId,
    }
  });
  
  console.log(`Published TICKET_CREATED event for ticket ${ticketId}`);
}

export async function testTicketAssignedNotification(ticketId: string, tenantId: string, userId: string) {
  const eventBus = getEventBus();
  
  await eventBus.publish({
    id: randomUUID(),
    eventType: 'TICKET_ASSIGNED',
    timestamp: new Date().toISOString(),
    payload: {
      tenantId,
      ticketId,
      userId,
    }
  });
  
  console.log(`Published TICKET_ASSIGNED event for ticket ${ticketId}`);
}

export async function testInvoiceGeneratedNotification(invoiceId: string, tenantId: string, userId: string) {
  const eventBus = getEventBus();
  
  await eventBus.publish({
    id: randomUUID(),
    eventType: 'INVOICE_GENERATED',
    timestamp: new Date().toISOString(),
    payload: {
      tenantId,
      invoiceId,
      userId,
    }
  });
  
  console.log(`Published INVOICE_GENERATED event for invoice ${invoiceId}`);
}

export async function testManualNotification(userId: number, title: string, message: string) {
  // Test the direct notification creation (non-event-based)
  try {
    const notification = await createNotificationAction({
      user_id: userId,
      type_id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef', // You'll need to use actual type_id from database
      title,
      message,
      action_url: '/msp/dashboard'
    });
    
    console.log(`Created manual notification: ${notification.internal_notification_id}`);
    return notification;
  } catch (error) {
    console.error('Failed to create manual notification:', error);
  }
}

// Example usage:
// await testTicketCreatedNotification('some-ticket-id', 'some-tenant-id', 'some-user-id');