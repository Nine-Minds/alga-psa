export interface WorkerConfig {
  temporalAddress: string;
  temporalNamespace: string;
  taskQueues: string[];
  maxConcurrentActivityTaskExecutions: number;
  maxConcurrentWorkflowTaskExecutions: number;
}

export const AUTHORED_RUNTIME_TASK_QUEUE = "workflow-runtime-v2";

/**
 * Get worker configuration from environment variables.
 */
export function getWorkerConfig(): WorkerConfig {
  // Non-authored/domain queues owned by temporal-worker.
  const defaultQueues = ["tenant-workflows", "portal-domain-workflows", "email-domain-workflows", "alga-jobs", "sla-workflows"];
  const queuesEnv =
    process.env.TEMPORAL_TASK_QUEUES || process.env.TEMPORAL_TASK_QUEUE;

  const parsedQueues = queuesEnv
    ? Array.from(
        new Set(
          queuesEnv
            .split(",")
            .map((queue) => queue.trim())
            .filter((queue) => queue.length > 0),
        ),
      )
    : defaultQueues;

  // Always ensure the shared job queue is present, even when env overrides are used.
  let taskQueues = parsedQueues.includes("alga-jobs")
    ? parsedQueues
    : [...parsedQueues, "alga-jobs"];

  if (!taskQueues.includes("sla-workflows")) {
    taskQueues = [...taskQueues, "sla-workflows"];
  }

  if (taskQueues.includes(AUTHORED_RUNTIME_TASK_QUEUE)) {
    throw new Error(
      `temporal-worker is not allowed to poll authored runtime queue "${AUTHORED_RUNTIME_TASK_QUEUE}". ` +
      `Queue ownership belongs to workflow-worker.`,
    );
  }

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
