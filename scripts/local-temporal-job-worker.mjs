#!/usr/bin/env node

import { Worker, NativeConnection } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import {
  initializeJobHandlersForWorker,
  jobActivities,
} from '../ee/temporal-workflows/dist/ee/temporal-workflows/src/activities/job-activities.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const temporalAddress = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const temporalNamespace = process.env.TEMPORAL_NAMESPACE || 'default';
const taskQueue = process.env.TEMPORAL_JOB_TASK_QUEUE || process.env.TEMPORAL_TASK_QUEUE || 'alga-jobs';

const workflowsPath = path.resolve(
  __dirname,
  '../ee/temporal-workflows/dist/ee/temporal-workflows/src/workflows/generic-job-workflow.js',
);

async function main() {
  console.log('[local-temporal-job-worker] starting', {
    temporalAddress,
    temporalNamespace,
    taskQueue,
    workflowsPath,
  });

  await initializeJobHandlersForWorker();

  const connection = await NativeConnection.connect({ address: temporalAddress });
  const worker = await Worker.create({
    connection,
    namespace: temporalNamespace,
    taskQueue,
    workflowsPath,
    activities: jobActivities,
    maxConcurrentActivityTaskExecutions: Number(process.env.MAX_CONCURRENT_ACTIVITIES || 10),
    maxConcurrentWorkflowTaskExecutions: Number(process.env.MAX_CONCURRENT_WORKFLOWS || 10),
  });

  const shutdown = async (signal) => {
    console.log(`[local-temporal-job-worker] received ${signal}, shutting down`);
    await worker.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  console.log('[local-temporal-job-worker] worker running');
  await worker.run();
}

main().catch((error) => {
  console.error('[local-temporal-job-worker] failed', error);
  process.exit(1);
});
