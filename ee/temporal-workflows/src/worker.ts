import { Worker, NativeConnection } from "@temporalio/worker";
import { createLogger, format, transports } from "winston";
import * as activities from "./activities/non-authored-index.js";
import { initializeJobHandlersForWorker } from "./activities/job-activities.js";
import * as dotenv from "dotenv";
import express from "express";
import {
  validateStartup,
  logConfiguration,
} from "./config/startupValidation.js";
import { setupSchedules } from "./schedules/setupSchedules.js";
import {
  AUTHORED_RUNTIME_TASK_QUEUE,
  getWorkerConfig,
  type WorkerConfig,
} from "./workerConfig.js";
import {
  reportWorkerHealth,
  startWorkerFailureWatchdog,
  type QueueWorker,
} from "./workerHealth.js";
import {
  registerInboundAuthPauseEventPublisher,
} from "@alga-psa/shared/services/email/inboundAuthPauseEventNotifier";
import {
  assertInboundAuthPauseNotifierRegistered,
} from "@alga-psa/shared/services/email/inboundAuthPauseNotifier";

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

/** Time for the failure log line to flush before the process exits. */
const FAILURE_EXIT_GRACE_MS = 2_000;

interface RunningQueue extends QueueWorker {
  worker: Worker;
}

/** Set by the signal handlers so a draining worker is not mistaken for a dead one. */
let shuttingDown = false;
const isShuttingDown = () => shuttingDown;

/**
 * Create and configure the Temporal worker
 */
async function createWorkers(config: WorkerConfig): Promise<RunningQueue[]> {
  logger.info("Connecting to Temporal", {
    address: config.temporalAddress,
    namespace: config.temporalNamespace,
  });

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  logger.info("Connected to Temporal successfully");

  const queues: RunningQueue[] = [];

  for (const taskQueue of config.taskQueues) {
    const worker = await Worker.create({
      connection,
      namespace: config.temporalNamespace,
      workflowsPath: new URL("./workflows/non-authored-index.js", import.meta.url).pathname,
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

    queues.push({ taskQueue, worker, getState: () => worker.getState() });
  }

  return queues;
}

/**
 * Handle graceful shutdown
 */
function setupGracefulShutdown(queues: RunningQueue[]): void {
  const shutdownHandler = async (signal: string) => {
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await Promise.all(queues.map(({ worker }) => worker.shutdown()));
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
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled rejection", { reason, promise });
    process.exit(1);
  });
}

/**
 * A worker that dies leaves its queue with no poller while the process, and
 * therefore the pod, looks fine. Exit so the orchestrator restarts everything;
 * Temporal keeps the queued tasks until the new pollers arrive.
 */
function startFailureWatchdog(queues: RunningQueue[]): void {
  startWorkerFailureWatchdog(queues, {
    isShuttingDown,
    onFailure: (dead, report) => {
      logger.error("Temporal worker died; exiting so the process is restarted", {
        deadQueues: dead.map((queue) => queue.taskQueue),
        queues: report.queues,
      });
      setTimeout(() => process.exit(1), FAILURE_EXIT_GRACE_MS).unref();
    },
  });
}

/**
 * Health check endpoint for Kubernetes. Liveness fails once any worker has
 * died; readiness fails unless every configured queue is being polled.
 */
function startHealthCheck(queues: RunningQueue[]): void {
  if (process.env.ENABLE_HEALTH_CHECK === "true") {
    const app = express();
    const port = process.env.HEALTH_CHECK_PORT || 8080;

    app.get("/health", (req: any, res: any) => {
      const report = reportWorkerHealth(queues, isShuttingDown());
      res.status(report.live ? 200 : 503).json({
        status: report.live ? "healthy" : "unhealthy",
        timestamp: new Date().toISOString(),
        worker: report.live ? "running" : "failed",
        queues: report.queues,
      });
    });

    app.get("/ready", (req: any, res: any) => {
      const report = reportWorkerHealth(queues, isShuttingDown());
      res.status(report.ready ? 200 : 503).json({
        status: report.ready ? "ready" : "not-ready",
        timestamp: new Date().toISOString(),
        worker: report.ready ? "ready" : "not-ready",
        queues: report.queues,
      });
    });

    app.listen(port, () => {
      logger.info(`Health check server listening on port ${port}`);
    });
  }
}

/**
 * Main function to start the worker
 */
async function main(): Promise<void> {
  try {
    logger.info("Starting Temporal worker for non-authored/domain workflows");

    // This runtime executes the Microsoft webhook-maintenance activities that
    // can perform the atomic auth-failure auto-pause, but it cannot load the
    // @alga-psa/notifications vertical (stubbed in this build graph): publish
    // the pause on the event bus and let the server-side subscriber deliver
    // the admin notifications (same hand-off as MAINTENANCE_JOB_REQUESTED).
    registerInboundAuthPauseEventPublisher();
    assertInboundAuthPauseNotifierRegistered("ee/temporal-workflows/worker");

    // Run startup validations
    try {
      await validateStartup();
      logConfiguration();
    } catch (error) {
      logger.error("Startup validation failed:", error);
      process.exit(1);
    }

    // Initialize job handlers for the generic job workflow
    try {
      await initializeJobHandlersForWorker();
      logger.info("Job handlers initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize job handlers:", error);
      process.exit(1);
    }

    // Get configuration
    const config = getWorkerConfig();
    logger.info("Worker configuration", config);
    logger.info("Authored runtime queue ownership", {
      authoredQueue: AUTHORED_RUNTIME_TASK_QUEUE,
      owner: "workflow-worker",
      temporalWorkerOwnsAuthoredQueue: false,
    });

    // Initialize schedules
    await setupSchedules();

    const queues = await createWorkers(config);

    // Setup graceful shutdown
    setupGracefulShutdown(queues);

    // Start health check server if enabled
    startHealthCheck(queues);
    startFailureWatchdog(queues);

    queues.forEach(({ taskQueue }) =>
      logger.info("Worker starting...", { taskQueue }),
    );

    await Promise.all(queues.map(({ worker }) => worker.run()));
  } catch (error) {
    logger.error("Failed to start worker", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
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
