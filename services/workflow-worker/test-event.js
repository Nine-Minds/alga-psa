/**
 * Test script to publish an event to the event bus
 */
import { getEventBus } from '../../server/src/lib/eventBus/index.js';

async function publishTestEvent() {
  try {
    console.log('Initializing event bus...');
    const eventBus = getEventBus();
    await eventBus.initialize();
    
    console.log('Publishing test event...');
    await eventBus.publish({
      eventType: 'TEST_EVENT',
      payload: {
        tenantId: 'test-tenant',
        message: 'This is a test event',
        timestamp: new Date().toISOString()
      }
    });
    
    console.log('Event published successfully!');
    
    // Wait a bit before closing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await eventBus.close();
    console.log('Event bus closed');
  } catch (error) {
    console.error('Error publishing event:', error);
  }
}

publishTestEvent();