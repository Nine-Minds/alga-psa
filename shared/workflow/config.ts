/**
 * Configuration for the workflow system
 */
export const workflowConfig = {
  /**
   * Whether to run in distributed mode (using Redis streams)
   * or synchronous mode (direct execution)
   */
  distributedMode: process.env.WORKFLOW_DISTRIBUTED_MODE === 'true',

  /**
   * Redis configuration for workflow streams
   */
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    streamMaxLen: 1000, // Maximum length of Redis streams
    consumerGroup: 'workflow-workers',
    streamKey: 'workflow-events'
  },

  /**
   * Workflow execution settings
   */
  execution: {
    maxRetries: 3,
    retryDelayMs: 1000,
    lockTtlMs: 60000,
    stateCacheTtlMs: 60000
  }
};