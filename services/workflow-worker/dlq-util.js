/**
 * Dead Letter Queue Utility
 * 
 * This script provides utilities for managing the dead letter queue (DLQ) for workflow events.
 * It allows listing, viewing, and reprocessing messages in the DLQ.
 * 
 * Usage:
 *   node dlq-util.js list <executionId> [count]
 *   node dlq-util.js view <executionId> <messageId>
 *   node dlq-util.js reprocess <executionId> <messageId>
 */

import { getRedisStreamClient } from '../../shared/workflow/streams/redisStreamClient.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();
  const executionId = args[1];
  
  if (!command || !executionId) {
    printUsage();
    process.exit(1);
  }
  
  const redisClient = getRedisStreamClient();
  await redisClient.initialize();
  
  try {
    switch (command) {
      case 'list':
        await listMessages(redisClient, executionId, args[2]);
        break;
      case 'view':
        await viewMessage(redisClient, executionId, args[2]);
        break;
      case 'reprocess':
        await reprocessMessage(redisClient, executionId, args[2]);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await redisClient.close();
  }
}

function printUsage() {
  console.log(`
Dead Letter Queue Utility

Usage:
  node dlq-util.js list <executionId> [count]
  node dlq-util.js view <executionId> <messageId>
  node dlq-util.js reprocess <executionId> <messageId>

Commands:
  list       List messages in the DLQ for a specific execution
  view       View details of a specific message in the DLQ
  reprocess  Move a message from the DLQ back to the original stream for reprocessing
  
Arguments:
  executionId  The workflow execution ID (use 'global' for the global event stream)
  messageId    The ID of the message in the DLQ
  count        Maximum number of messages to list (default: 100)
`);
}

async function listMessages(redisClient, executionId, countArg) {
  const count = parseInt(countArg) || 100;
  console.log(`Listing up to ${count} messages in DLQ for execution ${executionId}...`);
  
  const messages = await redisClient.listDeadLetterQueueMessages(executionId, count);
  
  if (messages.length === 0) {
    console.log('No messages found in DLQ.');
    return;
  }
  
  console.log(`Found ${messages.length} messages in DLQ:`);
  console.log('-----------------------------------');
  
  for (const message of messages) {
    console.log(`ID: ${message.id}`);
    console.log(`Error: ${message.error_message}`);
    console.log(`Moved at: ${message.moved_at}`);
    console.log('-----------------------------------');
  }
}

async function viewMessage(redisClient, executionId, messageId) {
  if (!messageId) {
    console.error('Message ID is required for view command');
    printUsage();
    process.exit(1);
  }
  
  console.log(`Viewing message ${messageId} in DLQ for execution ${executionId}...`);
  
  const messages = await redisClient.listDeadLetterQueueMessages(executionId);
  const message = messages.find(msg => msg.id === messageId);
  
  if (!message) {
    console.error(`Message ${messageId} not found in DLQ for execution ${executionId}`);
    return;
  }
  
  console.log('Message details:');
  console.log('-----------------------------------');
  console.log(`ID: ${message.id}`);
  console.log(`Original ID: ${message.original_id}`);
  console.log(`Source Stream: ${message.source_stream}`);
  console.log(`Moved at: ${message.moved_at}`);
  console.log(`Error Message: ${message.error_message}`);
  console.log('\nError Stack:');
  console.log(message.error_stack);
  console.log('\nOriginal Message:');
  try {
    const originalMessage = JSON.parse(message.original_message);
    console.log(JSON.stringify(originalMessage, null, 2));
  } catch (error) {
    console.log(message.original_message);
  }
  console.log('-----------------------------------');
}

async function reprocessMessage(redisClient, executionId, messageId) {
  if (!messageId) {
    console.error('Message ID is required for reprocess command');
    printUsage();
    process.exit(1);
  }
  
  console.log(`Reprocessing message ${messageId} from DLQ for execution ${executionId}...`);
  
  const success = await redisClient.reprocessDeadLetterQueueMessage(executionId, messageId);
  
  if (success) {
    console.log(`Successfully reprocessed message ${messageId}`);
  } else {
    console.error(`Failed to reprocess message ${messageId}`);
  }
}

main().catch(console.error);