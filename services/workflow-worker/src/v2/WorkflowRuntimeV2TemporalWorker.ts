import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import logger from '@alga-psa/core/logger';
import { WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE } from '@alga-psa/workflows/lib/workflowRuntimeV2TemporalContract';

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DIST_WORKFLOWS_PATH = '../../ee/temporal-workflows/dist/ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.js';
const DIST_ACTIVITIES_PATH = '../../ee/temporal-workflows/dist/ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.js';
const SOURCE_WORKFLOWS_PATH = '../../ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts';
const SOURCE_ACTIVITIES_PATH = '../../ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts';

function resolveTemporalRuntimeModulePath(options: {
  envOverride: string | undefined;
  useSourcePaths: boolean;
  sourceRelativePath: string;
  distRelativePath: string;
}): string {
  if (options.envOverride) {
    return path.resolve(process.cwd(), options.envOverride);
  }

  const preferredRelativePath = options.useSourcePaths
    ? options.sourceRelativePath
    : options.distRelativePath;
  const preferredAbsolutePath = path.resolve(process.cwd(), preferredRelativePath);
  if (fs.existsSync(preferredAbsolutePath)) {
    return preferredAbsolutePath;
  }

  const fallbackRelativePath = options.useSourcePaths
    ? options.distRelativePath
    : options.sourceRelativePath;
  const fallbackAbsolutePath = path.resolve(process.cwd(), fallbackRelativePath);
  if (fs.existsSync(fallbackAbsolutePath)) {
    return fallbackAbsolutePath;
  }

  throw new Error(
    `Unable to resolve Temporal runtime module. Checked ${preferredAbsolutePath} and ${fallbackAbsolutePath}.`,
  );
}

export class WorkflowRuntimeV2TemporalWorker {
  private readonly workerId: string;
  private worker: Worker | null = null;
  private connection: NativeConnection | null = null;
  private runPromise: Promise<void> | null = null;
  private readonly temporalAddress: string;
  private readonly temporalNamespace: string;
  private readonly taskQueue: string;
  private readonly workflowsPath: string;
  private readonly activitiesPath: string;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.temporalAddress = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    this.temporalNamespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
    this.taskQueue = process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE || WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE;
    const useSourcePaths = ['true', '1', 'yes'].includes(
      String(process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_USE_SOURCE_PATHS ?? '').toLowerCase(),
    );
    this.workflowsPath = resolveTemporalRuntimeModulePath({
      envOverride: process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_WORKFLOWS_PATH,
      useSourcePaths,
      sourceRelativePath: SOURCE_WORKFLOWS_PATH,
      distRelativePath: DIST_WORKFLOWS_PATH,
    });
    this.activitiesPath = resolveTemporalRuntimeModulePath({
      envOverride: process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_ACTIVITIES_PATH,
      useSourcePaths,
      sourceRelativePath: SOURCE_ACTIVITIES_PATH,
      distRelativePath: DIST_ACTIVITIES_PATH,
    });
  }

  async start(): Promise<void> {
    if (this.runPromise) {
      return;
    }

    logger.info('[WorkflowRuntimeV2TemporalWorker] Starting Temporal polling', {
      workerId: this.workerId,
      temporalAddress: this.temporalAddress,
      temporalNamespace: this.temporalNamespace,
      taskQueue: this.taskQueue,
      workflowsPath: this.workflowsPath,
      activitiesPath: this.activitiesPath,
    });

    const workflowRuntimeActivities = await import(pathToFileURL(this.activitiesPath).href);

    this.connection = await NativeConnection.connect({
      address: this.temporalAddress,
    });

    this.worker = await Worker.create({
      connection: this.connection,
      namespace: this.temporalNamespace,
      taskQueue: this.taskQueue,
      workflowsPath: this.workflowsPath,
      activities: workflowRuntimeActivities,
      debugMode: process.env.NODE_ENV === 'development',
    });

    this.runPromise = this.worker.run().catch((error) => {
      logger.error('[WorkflowRuntimeV2TemporalWorker] Runtime polling terminated', {
        workerId: this.workerId,
        taskQueue: this.taskQueue,
        error,
      });
      throw error;
    });

    logger.info('[WorkflowRuntimeV2TemporalWorker] Temporal polling started', {
      workerId: this.workerId,
      taskQueue: this.taskQueue,
    });
  }

  async stop(): Promise<void> {
    const worker = this.worker;
    const runPromise = this.runPromise;

    if (!worker || !runPromise) {
      return;
    }

    logger.info('[WorkflowRuntimeV2TemporalWorker] Stopping Temporal polling', {
      workerId: this.workerId,
      taskQueue: this.taskQueue,
    });

    await worker.shutdown();
    await runPromise.catch(() => undefined);
    await this.connection?.close().catch(() => undefined);

    this.worker = null;
    this.connection = null;
    this.runPromise = null;

    logger.info('[WorkflowRuntimeV2TemporalWorker] Temporal polling stopped', {
      workerId: this.workerId,
      taskQueue: this.taskQueue,
    });
  }
}
