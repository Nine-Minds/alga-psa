/**
 * Workflow Worker Entry Point
 *
 * This script initializes and starts a single workflow worker instance
 * and an HTTP server for health checks.
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import { getWorkflowRuntime, getActionRegistry } from '@shared/workflow/core/index.js';
import { initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime';
import { WorkflowRuntimeV2Worker } from './v2/WorkflowRuntimeV2Worker.js';
import { WorkflowRuntimeV2EventStreamWorker } from './v2/WorkflowRuntimeV2EventStreamWorker.js';
import { WorkflowWorker } from './WorkflowWorker.js';
import { WorkerServer } from './server.js';
import logger from '@alga-psa/core/logger';
import { initializeServerWorkflows } from '@shared/workflow/index.js';
import { registerAccountingExportWorkflowActions } from 'server/src/lib/workflow/registerAccountingExportActions';
import { updateSystemWorkflowsFromAssets } from './init/updateWorkflows.js';
import { registerEmailAttachmentActions } from './actions/registerEmailAttachmentActions.js';

async function registerEnterpriseStorageProviders(): Promise<void> {
  const isEnterprise =
    process.env.EDITION === 'enterprise' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  if (!isEnterprise) return;

  try {
    const { S3StorageProvider } = await import('@ee/lib/storage/providers/S3StorageProvider');
    (global as any).S3StorageProvider = S3StorageProvider;
    logger.info('[WorkflowWorker] Registered S3StorageProvider for enterprise edition');
  } catch (error) {
    logger.warn('[WorkflowWorker] S3StorageProvider not available; continuing without S3 provider');
  }
}

async function startServices() {
  try {
    logger.info('[WorkflowWorker] Initializing services');
    
    const mode = (process.env.WORKFLOW_WORKER_MODE || 'all').trim().toLowerCase();
    const enableLegacy = mode === 'all' || mode === 'legacy';
    const enableV2 = mode === 'all' || mode === 'v2';
    const verbose =
      process.env.WORKFLOW_WORKER_VERBOSE === 'true' ||
      process.env.WORKFLOW_WORKER_VERBOSE === '1' ||
      process.env.WORKFLOW_WORKER_VERBOSE === 'yes';

    if (!enableLegacy && !enableV2) {
      throw new Error(`Invalid WORKFLOW_WORKER_MODE=${process.env.WORKFLOW_WORKER_MODE ?? ''} (expected: all|legacy|v2)`);
    }

    logger.info('[WorkflowWorker] Mode selection', {
      mode,
      enableLegacy,
      enableV2,
      verbose,
      logLevel: process.env.LOG_LEVEL ?? null,
    });

    if (enableV2) {
      initializeWorkflowRuntimeV2();
    }

    let legacyWorker: WorkflowWorker | null = null;
    let legacyServer: WorkerServer | null = null;
    if (enableLegacy) {
      await initializeServerWorkflows();
      registerAccountingExportWorkflowActions();

      // Register enterprise storage providers (required for StorageProviderFactory in worker context)
      await registerEnterpriseStorageProviders();

      await updateSystemWorkflowsFromAssets();

      const actionRegistry = getActionRegistry();
      registerEmailAttachmentActions(actionRegistry);
      const workflowRuntime = getWorkflowRuntime(actionRegistry);

      const workerConfig = {
        pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '300000', 10),
        batchSize: parseInt(process.env.BATCH_SIZE || '10', 10),
        maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
        concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT || '5', 10),
        healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '30000', 10),
        metricsReportingIntervalMs: parseInt(process.env.METRICS_REPORTING_INTERVAL_MS || '60000', 10)
      };

      logger.info('[WorkflowWorker] Starting legacy worker with config:', workerConfig);
      legacyWorker = new WorkflowWorker(workflowRuntime, workerConfig);
      legacyServer = new WorkerServer(legacyWorker);
    } else {
      logger.info('[WorkflowWorker] Legacy worker disabled (WORKFLOW_WORKER_MODE=v2)');
    }

    const runtimeV2WorkerId = enableV2 ? `runtime-v2-${Date.now()}` : null;
    const runtimeV2EventWorkerId = enableV2 ? `runtime-v2-events-${Date.now()}` : null;
    const runtimeV2Worker = runtimeV2WorkerId ? new WorkflowRuntimeV2Worker(runtimeV2WorkerId) : null;
    const runtimeV2EventWorker = runtimeV2EventWorkerId ? new WorkflowRuntimeV2EventStreamWorker(runtimeV2EventWorkerId) : null;
    if (enableV2) {
      logger.info('[WorkflowWorker] Starting runtime v2 workers', {
        runtimeV2WorkerId,
        runtimeV2EventWorkerId,
        consumerGroup: process.env.WORKFLOW_RUNTIME_V2_EVENT_CONSUMER_GROUP ?? 'workflow-runtime-v2',
      });
    }

    const startPromises: Promise<unknown>[] = [];
    if (legacyWorker && legacyServer) {
      startPromises.push(legacyWorker.start(), legacyServer.start());
    }
    if (runtimeV2Worker && runtimeV2EventWorker) {
      startPromises.push(runtimeV2Worker.start(), runtimeV2EventWorker.start());
    }

    await Promise.all(startPromises);
    
    logger.info('[WorkflowWorker] All services started successfully');
    
    // Handle graceful shutdown
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    async function shutdown() {
      logger.info('[WorkflowWorker] Shutting down services...');
      const stopPromises: Promise<unknown>[] = [];
      if (legacyWorker && legacyServer) {
        stopPromises.push(legacyWorker.stop(), legacyServer.stop());
      }
      if (runtimeV2Worker && runtimeV2EventWorker) {
        stopPromises.push(runtimeV2Worker.stop(), runtimeV2EventWorker.stop());
      }
      await Promise.all(stopPromises);
      process.exit(0);
    }
  } catch (error) {
    logger.error('[WorkflowWorker] Failed to start services:', error);
    process.exit(1);
  }
}

// Start all services
startServices();
