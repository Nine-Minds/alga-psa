/**
 * Workflow Worker Entry Point
 *
 * This script initializes and starts a single workflow worker instance
 * and an HTTP server for health checks.
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import { initializeWorkflowRuntimeV2, registerWorkflowEmailProvider } from '@alga-psa/workflows/runtime/worker';
import { WorkflowRuntimeV2Worker } from '@alga-psa/workflows/workers';
import { WorkflowRuntimeV2EventStreamWorker } from './v2/WorkflowRuntimeV2EventStreamWorker.js';
import { WorkflowRuntimeV2TemporalWorker } from './v2/WorkflowRuntimeV2TemporalWorker.js';
import logger from '@alga-psa/core/logger';
import { TenantEmailService, StaticTemplateProcessor, EmailProviderManager } from '@alga-psa/email';
import { registerEnterpriseStorageProviders } from './registerEnterpriseStorageProviders.js';

async function startServices() {
  try {
    logger.info('[WorkflowWorker] Initializing services');
    const verbose =
      process.env.WORKFLOW_WORKER_VERBOSE === 'true' ||
      process.env.WORKFLOW_WORKER_VERBOSE === '1' ||
      process.env.WORKFLOW_WORKER_VERBOSE === 'yes';

    logger.info('[WorkflowWorker] Mode selection', {
      mode: 'v2',
      enableLegacy: false,
      enableV2: true,
      verbose,
      logLevel: process.env.LOG_LEVEL ?? null,
    });

    initializeWorkflowRuntimeV2();

    // Workflow actions resolve email integrations through a runtime registry.
    // The API server registers this during app bootstrap; the worker must do the same.
    registerWorkflowEmailProvider({
      TenantEmailService: TenantEmailService as any,
      StaticTemplateProcessor: StaticTemplateProcessor as any,
      EmailProviderManager: EmailProviderManager as any,
    });

    await registerEnterpriseStorageProviders();

    const runtimeV2WorkerId = `runtime-v2-${Date.now()}`;
    const runtimeV2EventWorkerId = `runtime-v2-events-${Date.now()}`;
    const runtimeV2TemporalWorkerId = `runtime-v2-temporal-${Date.now()}`;
    const runtimeV2Worker = new WorkflowRuntimeV2Worker(runtimeV2WorkerId);
    const runtimeV2EventWorker = new WorkflowRuntimeV2EventStreamWorker(runtimeV2EventWorkerId);
    const runtimeV2TemporalWorker = new WorkflowRuntimeV2TemporalWorker(runtimeV2TemporalWorkerId);
    const enableDbPollingWorker =
      process.env.WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING === 'true'
      || process.env.WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING === '1';
    const enableTemporalPolling = !['false', '0', 'no'].includes(
      String(process.env.WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING ?? 'true').toLowerCase(),
    );
    logger.info('[WorkflowWorker] Starting runtime v2 workers', {
      runtimeV2WorkerId,
      runtimeV2EventWorkerId,
      runtimeV2TemporalWorkerId,
      consumerGroup: process.env.WORKFLOW_RUNTIME_V2_EVENT_CONSUMER_GROUP ?? 'workflow-runtime-v2',
      temporalQueue: process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE ?? 'workflow-runtime-v2',
      temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'temporal-frontend.temporal.svc.cluster.local:7233',
      temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
      enableDbPollingWorker,
      enableTemporalPolling,
    });
    if (enableTemporalPolling) {
      await runtimeV2TemporalWorker.start();
    } else {
      logger.info('[WorkflowWorker] Authored Temporal polling disabled for this environment');
    }
    await runtimeV2EventWorker.start();
    if (enableDbPollingWorker) {
      await runtimeV2Worker.start();
    } else {
      logger.info('[WorkflowWorker] DB polling runtime worker disabled; Temporal-native runtime is authoritative for new runs');
    }
    
    logger.info('[WorkflowWorker] All services started successfully');
    
    // Handle graceful shutdown
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    async function shutdown() {
      logger.info('[WorkflowWorker] Shutting down services...');
      await Promise.all([
        enableTemporalPolling ? runtimeV2TemporalWorker.stop() : Promise.resolve(),
        runtimeV2EventWorker.stop(),
        enableDbPollingWorker ? runtimeV2Worker.stop() : Promise.resolve()
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
