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
import { WorkflowDataStoreSweepWorker } from '@alga-psa/workflows/workers';
import { WorkflowRuntimeV2EventStreamWorker } from './v2/WorkflowRuntimeV2EventStreamWorker.js';
import { WorkflowRuntimeV2TemporalWorker } from './v2/WorkflowRuntimeV2TemporalWorker.js';
import logger from '@alga-psa/core/logger';
import { TenantEmailService, StaticTemplateProcessor, EmailProviderManager } from '@alga-psa/email';
import { HealthServer } from './healthServer.js';
import { registerEnterpriseStorageProviders } from './registerEnterpriseStorageProviders.js';

async function startServices() {
  const healthServer = new HealthServer();
  try {
    // Start the health HTTP server before anything else so kubelet probes
    // (rewritten by the Istio sidecar to hit localhost:PORT/health) get a
    // response — 503 until the workers finish starting, 200 after.
    await healthServer.start();

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

    const runtimeV2EventWorkerId = `runtime-v2-events-${Date.now()}`;
    const runtimeV2TemporalWorkerId = `runtime-v2-temporal-${Date.now()}`;
    const dataStoreSweepWorkerId = `data-store-sweep-${Date.now()}`;
    const runtimeV2EventWorker = new WorkflowRuntimeV2EventStreamWorker(runtimeV2EventWorkerId);
    const runtimeV2TemporalWorker = new WorkflowRuntimeV2TemporalWorker(runtimeV2TemporalWorkerId);
    const dataStoreSweepWorker = new WorkflowDataStoreSweepWorker(dataStoreSweepWorkerId);
    logger.info('[WorkflowWorker] Starting runtime v2 workers', {
      runtimeV2EventWorkerId,
      runtimeV2TemporalWorkerId,
      dataStoreSweepWorkerId,
      consumerGroup: process.env.WORKFLOW_RUNTIME_V2_EVENT_CONSUMER_GROUP ?? 'workflow-runtime-v2',
      temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'temporal-frontend.temporal.svc.cluster.local:7233',
      temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    });
    await runtimeV2TemporalWorker.start();
    healthServer.setWorker('temporal', true);
    await runtimeV2EventWorker.start();
    healthServer.setWorker('eventStream', true);
    await dataStoreSweepWorker.start();
    healthServer.setWorker('dataStoreSweep', true);

    healthServer.markReady();
    logger.info('[WorkflowWorker] All services started successfully');

    // Handle graceful shutdown
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    async function shutdown() {
      logger.info('[WorkflowWorker] Shutting down services...');
      await Promise.all([
        runtimeV2TemporalWorker.stop(),
        runtimeV2EventWorker.stop(),
        dataStoreSweepWorker.stop(),
        healthServer.stop(),
      ]);
      process.exit(0);
    }
  } catch (error) {
    logger.error('[WorkflowWorker] Failed to start services:', error);
    await healthServer.stop().catch(() => undefined);
    process.exit(1);
  }
}

// Start all services
startServices();
