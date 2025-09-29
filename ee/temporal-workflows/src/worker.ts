import { Worker, NativeConnection } from "@temporalio/worker";
import {
  WorkflowClient,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import { createLogger, format, transports } from "winston";
import * as activities from "./activities/index.js";
import * as dotenv from "dotenv";
import express from "express";
import {
  validateStartup,
  logConfiguration,
} from "./config/startupValidation.js";
import {
  PORTAL_DOMAIN_APPLY_COORDINATOR_WORKFLOW_ID,
  portalDomainApplyCoordinatorWorkflow,
} from "./workflows/portal-domains/apply-coordinator.workflow.js";

// Load environment variables
dotenv.config();

// Configure logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json(),
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
  ],
});

/**
 * Configuration for the Temporal worker
 */
interface WorkerConfig {
  temporalAddress: string;
  temporalNamespace: string;
  taskQueues: string[];
  maxConcurrentActivityTaskExecutions: number;
  maxConcurrentWorkflowTaskExecutions: number;
}

/**
 * Get worker configuration from environment variables
 */
function getWorkerConfig(): WorkerConfig {
  const defaultQueues = ["tenant-workflows", "portal-domain-workflows"];
  const queuesEnv =
    process.env.TEMPORAL_TASK_QUEUES || process.env.TEMPORAL_TASK_QUEUE;

  const taskQueues = queuesEnv
    ? Array.from(
        new Set(
          queuesEnv
            .split(",")
            .map((queue) => queue.trim())
            .filter((queue) => queue.length > 0),
        ),
      )
    : defaultQueues;

  return {
    temporalAddress:
      process.env.TEMPORAL_ADDRESS ||
      "temporal-frontend.temporal.svc.cluster.local:7233",
    temporalNamespace: process.env.TEMPORAL_NAMESPACE || "default",
    taskQueues: taskQueues.length > 0 ? taskQueues : defaultQueues,
    maxConcurrentActivityTaskExecutions: parseInt(
      process.env.MAX_CONCURRENT_ACTIVITIES || "10",
    ),
    maxConcurrentWorkflowTaskExecutions: parseInt(
      process.env.MAX_CONCURRENT_WORKFLOWS || "10",
    ),
  };
}

/**
 * Create and configure the Temporal worker
 */
async function createWorkers(
  connection: NativeConnection,
  config: WorkerConfig,
): Promise<Worker[]> {
  const workers: Worker[] = [];

  for (const taskQueue of config.taskQueues) {
    const worker = await Worker.create({
      connection,
      namespace: config.temporalNamespace,
      workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
      activities,
      taskQueue,
      maxConcurrentActivityTaskExecutions:
        config.maxConcurrentActivityTaskExecutions,
      maxConcurrentWorkflowTaskExecutions:
        config.maxConcurrentWorkflowTaskExecutions,
      debugMode: process.env.NODE_ENV === "development",
    });

    logger.info("Worker created successfully", {
      taskQueue,
      maxConcurrentActivities: config.maxConcurrentActivityTaskExecutions,
      maxConcurrentWorkflows: config.maxConcurrentWorkflowTaskExecutions,
    });

    workers.push(worker);
  }

  return workers;
}

/**
 * Handle graceful shutdown
 */
function setupGracefulShutdown(
  workers: Worker[],
  connection: NativeConnection,
): void {
  const shutdownHandler = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await Promise.all(workers.map((worker) => worker.shutdown()));
      await connection.close();
      logger.info("Worker shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error("Error during worker shutdown", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdownHandler("SIGINT"));
  process.on("SIGTERM", () => shutdownHandler("SIGTERM"));

  // Handle uncaught exceptions and unhandled rejections
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", {
      error: error.message,
      stack: error.stack,
    });
    connection.close().catch(() => undefined);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled rejection", { reason, promise });
    connection.close().catch(() => undefined);
    process.exit(1);
  });
}

/**
 * Health check endpoint for Kubernetes
 */
function startHealthCheck(): void {
  if (process.env.ENABLE_HEALTH_CHECK === "true") {
    const app = express();
    const port = process.env.HEALTH_CHECK_PORT || 8080;

    app.get("/health", (req: any, res: any) => {
      res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        worker: "running",
      });
    });

    app.get("/ready", (req: any, res: any) => {
      res.status(200).json({
        status: "ready",
        timestamp: new Date().toISOString(),
        worker: "ready",
      });
    });

    app.listen(port, () => {
      logger.info(`Health check server listening on port ${port}`);
    });
  }
}

async function ensurePortalDomainCoordinator(
  client: WorkflowClient,
  config: WorkerConfig,
): Promise<void> {
  const coordinatorTaskQueue =
    config.taskQueues.find((queue) => queue.includes("portal-domain")) ??
    config.taskQueues[0];

  try {
    await client.workflow.start(portalDomainApplyCoordinatorWorkflow, {
      workflowId: PORTAL_DOMAIN_APPLY_COORDINATOR_WORKFLOW_ID,
      taskQueue: coordinatorTaskQueue,
      workflowIdReusePolicy:
        WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
    });
    logger.info("Started portal domain apply coordinator", {
      workflowId: PORTAL_DOMAIN_APPLY_COORDINATOR_WORKFLOW_ID,
      taskQueue: coordinatorTaskQueue,
    });
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      logger.info("Portal domain apply coordinator already running", {
        workflowId: PORTAL_DOMAIN_APPLY_COORDINATOR_WORKFLOW_ID,
      });
      return;
    }
    throw error;
  }
}

/**
 * Main function to start the worker
 */
async function main(): Promise<void> {
  let connection: NativeConnection | null = null;
  try {
    logger.info("Starting Temporal worker for tenant workflows");

    // Run startup validations
    try {
      await validateStartup();
      logConfiguration();
    } catch (error) {
      logger.error("Startup validation failed:", error);
      process.exit(1);
    }

    // Get configuration
    const config = getWorkerConfig();
    logger.info("Worker configuration", config);

    logger.info("Connecting to Temporal", {
      address: config.temporalAddress,
      namespace: config.temporalNamespace,
    });

    connection = await NativeConnection.connect({
      address: config.temporalAddress,
    });
    logger.info("Connected to Temporal successfully");

    const client = new WorkflowClient({
      connection,
      namespace: config.temporalNamespace,
    });

    await ensurePortalDomainCoordinator(client, config);

    const workers = await createWorkers(connection, config);

    // Setup graceful shutdown
    setupGracefulShutdown(workers, connection);

    // Start health check server if enabled
    startHealthCheck();

    config.taskQueues.forEach((taskQueue) =>
      logger.info("Worker starting...", { taskQueue }),
    );

    await Promise.all(workers.map((worker) => worker.run()));
  } catch (error) {
    logger.error("Failed to start worker", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (connection) {
      await connection.close().catch(() => undefined);
    }
    process.exit(1);
  }
}

// Start the worker if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Worker failed to start:", error);
    process.exit(1);
  });
}

export { main as startWorker };
