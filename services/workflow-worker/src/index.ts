/**
 * Workflow Worker Entry Point
 *
 * This script initializes and starts a single workflow worker instance
 * and an HTTP server for health checks.
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime.js';
import { getActionRegistry } from '@shared/workflow/core/actionRegistry.js';
import { WorkflowWorker } from './WorkflowWorker.js';
import { WorkerServer } from './server.js';
import logger from '@shared/core/logger.js';
import { initializeServerWorkflows } from '@shared/workflow/init/serverInit.js';
import { registerEmailActions } from './emailActionRegistrations.js';

async function startServices() {
  try {
    logger.info('[WorkflowWorker] Initializing services');
    
    // Initialize the workflow system
    await initializeServerWorkflows();
    
    // Get the action registry and workflow runtime
    const actionRegistry = getActionRegistry();
    
    // Register email-specific actions for workflow worker
    registerEmailActions(actionRegistry);
    
    const workflowRuntime = getWorkflowRuntime(actionRegistry);
    
    // Create worker instance with configuration from environment
    const workerConfig = {
      pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '300000', 10),
      batchSize: parseInt(process.env.BATCH_SIZE || '10', 10),
      maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
      concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT || '5', 10),
      healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '30000', 10),
      metricsReportingIntervalMs: parseInt(process.env.METRICS_REPORTING_INTERVAL_MS || '60000', 10)
    };
    
    logger.info('[WorkflowWorker] Starting with config:', workerConfig);
    const worker = new WorkflowWorker(workflowRuntime, workerConfig);
    
    // Create HTTP server instance
    const server = new WorkerServer(worker);
    
    // Start both services
    await Promise.all([
      worker.start(),
      server.start()
    ]);
    
    logger.info('[WorkflowWorker] All services started successfully');
    
    // Handle graceful shutdown
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    async function shutdown() {
      logger.info('[WorkflowWorker] Shutting down services...');
      await Promise.all([
        worker.stop(),
        server.stop()
      ]);
      process.exit(0);
    }
  } catch (error) {
    logger.error('[WorkflowWorker] Failed to start services:', error);
    process.exit(1);
  }
}

// Start all services
startServices();
