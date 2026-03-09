/**
 * Configuration for the workflow system
 */

export const workflowConfig = {
  /**
   * All events are processed asynchronously through Redis streams and workers
   */
  
  /**
   * Number of worker instances to run
   */
  workerCount: parseInt(process.env.WORKFLOW_WORKER_COUNT || '2', 10),
  
  /**
   * Redis stream configuration
   */
  redis: {
    streamPrefix: process.env.WORKFLOW_REDIS_STREAM_PREFIX || 'workflow:events:',
    consumerGroup: process.env.WORKFLOW_REDIS_CONSUMER_GROUP || 'workflow-workers',
    batchSize: parseInt(process.env.WORKFLOW_REDIS_BATCH_SIZE || '10', 10),
    idleTimeoutMs: parseInt(process.env.WORKFLOW_REDIS_IDLE_TIMEOUT_MS || '60000', 10),
  }
};