/**
 * Test script to publish a message directly to Redis stream
 */
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { getSecretProviderInstance } from '../../shared/core/secretProvider.js';

// Load environment variables
dotenv.config();

async function publishTestEvent() {
  try {
    console.log('Connecting to Redis...');
    
    // Get Redis password from secret provider with fallback to environment variable
    const secretProvider = await getSecretProviderInstance();
    const redisPassword = await secretProvider.getAppSecret('REDIS_PASSWORD') || process.env.REDIS_PASSWORD;
    
    // Create Redis client
    const client = createClient({
      url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
      password: redisPassword
    });
    
    // Handle connection errors
    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    // Connect to Redis
    await client.connect();
    console.log('Connected to Redis');
    
    // Create a test event that matches the WorkflowEventBaseSchema
    const event = {
      event_id: uuidv4(),
      execution_id: uuidv4(),
      event_name: 'TEST_EVENT',
      event_type: 'TEST_EVENT',
      tenant: 'test-tenant',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId: 'test-tenant',
        message: 'This is a test event',
        timestamp: new Date().toISOString()
      }
    };
    
    // Publish to the global workflow events stream
    const streamName = 'workflow:events:global';
    
    console.log(`Publishing test event to stream: ${streamName}`);
    const messageId = await client.xAdd(
      streamName,
      '*', // Auto-generate ID
      { event: JSON.stringify(event) }
    );
    
    console.log(`Event published successfully with ID: ${messageId}`);
    
    // Close Redis connection
    await client.quit();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error publishing event:', error);
  }
}

publishTestEvent();