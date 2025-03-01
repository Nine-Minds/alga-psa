#!/usr/bin/env node
/**
 * Workflow Worker Service
 * 
 * This script starts the workflow worker service as a standalone process.
 * It can be run directly or through a process manager like PM2.
 * 
 * Usage:
 *   npm run workflow-worker
 *   
 * Environment variables:
 *   WORKER_COUNT: Number of worker instances to run (default: number of CPU cores)
 *   POLL_INTERVAL_MS: How often to poll for new events (default: 1000ms)
 *   BATCH_SIZE: Number of events to process in a batch (default: 10)
 *   MAX_RETRIES: Maximum number of retry attempts for failed events (default: 3)
 *   CONCURRENCY_LIMIT: Maximum number of events to process concurrently per worker (default: 5)
 */

import { startWorkerService, WorkerServiceConfig } from '../lib/workflow/workers/workerService';
import { WorkflowWorkerConfig } from '../lib/workflow/workers/workflowWorker';
import logger from '../utils/logger';

// Parse environment variables
const workerCount = parseInt(process.env.WORKER_COUNT || '0', 10) || undefined;
const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || '1000', 10);
const batchSize = parseInt(process.env.BATCH_SIZE || '10', 10);
const maxRetries = parseInt(process.env.MAX_RETRIES || '3', 10);
const concurrencyLimit = parseInt(process.env.CONCURRENCY_LIMIT || '5', 10);
const healthCheckIntervalMs = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '30000', 10);
const metricsReportingIntervalMs = parseInt(process.env.METRICS_REPORTING_INTERVAL_MS || '60000', 10);

// Configure worker service
const workerConfig: Partial<WorkflowWorkerConfig> = {
  pollIntervalMs,
  batchSize,
  maxRetries,
  concurrencyLimit,
  healthCheckIntervalMs,
  metricsReportingIntervalMs
};

const serviceConfig: WorkerServiceConfig = {
  workerCount,
  workerConfig,
  autoStart: true
};

// Log startup information
logger.info('[WorkflowWorker] Starting workflow worker service', {
  workerCount: workerCount || 'auto (CPU cores)',
  pollIntervalMs,
  batchSize,
  maxRetries,
  concurrencyLimit
});

// Start the worker service
startWorkerService(serviceConfig)
  .then(service => {
    logger.info('[WorkflowWorker] Workflow worker service started successfully');
    
    // Log statistics periodically
    setInterval(() => {
      const health = service.getHealth();
      const stats = service.getStatistics();
      
      logger.info('[WorkflowWorker] Service status', {
        status: health.status,
        workers: `${health.healthyWorkers}/${health.workerCount} healthy`,
        eventsProcessed: stats.totalEventsProcessed,
        eventsSucceeded: stats.totalEventsSucceeded,
        eventsFailed: stats.totalEventsFailed,
        activeEvents: stats.activeEventCount
      });
    }, 60000); // Log every minute
    
    // Handle process signals for graceful shutdown
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info(`[WorkflowWorker] Received ${signal}, shutting down gracefully...`);
        
        try {
          await service.stop();
          logger.info('[WorkflowWorker] Workflow worker service stopped successfully');
          process.exit(0);
        } catch (error) {
          logger.error('[WorkflowWorker] Error during shutdown:', error);
          process.exit(1);
        }
      });
    }
  })
  .catch(error => {
    logger.error('[WorkflowWorker] Failed to start workflow worker service:', error);
    process.exit(1);
  });