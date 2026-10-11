/**
 * Per-queue health for the multi-queue temporal-worker process.
 *
 * One Node process runs one Temporal Worker per task queue. A single worker can
 * die (the SDK marks it FAILED after a non-retryable poll error) while the
 * others keep polling, so "the process is up" says nothing about whether every
 * queue has a poller. Kubernetes only sees the process, so this module turns
 * worker state into something the probes and a watchdog can act on.
 */
import type { Worker } from "@temporalio/worker";

export type WorkerState = ReturnType<Worker["getState"]>;

export interface QueueWorker {
  taskQueue: string;
  getState(): WorkerState;
}

export interface QueueStatus {
  taskQueue: string;
  state: WorkerState;
}

export interface WorkerHealthReport {
  /** No worker has died. False once any worker is FAILED or STOPPED outside a requested shutdown. */
  live: boolean;
  /** Every worker is polling its queue. */
  ready: boolean;
  queues: QueueStatus[];
}

const DEAD_STATES: ReadonlySet<WorkerState> = new Set<WorkerState>(["FAILED", "STOPPED"]);

export function reportWorkerHealth(
  workers: readonly QueueWorker[],
  shuttingDown: boolean,
): WorkerHealthReport {
  const queues = workers.map((worker) => ({
    taskQueue: worker.taskQueue,
    state: worker.getState(),
  }));
  const live = shuttingDown || queues.every((queue) => !DEAD_STATES.has(queue.state));
  const ready =
    !shuttingDown && queues.length > 0 && queues.every((queue) => queue.state === "RUNNING");
  return { live, ready, queues };
}

export function deadQueues(report: WorkerHealthReport): QueueStatus[] {
  return report.queues.filter((queue) => DEAD_STATES.has(queue.state));
}

export interface FailureWatchdogOptions {
  intervalMs?: number;
  isShuttingDown: () => boolean;
  onFailure: (dead: QueueStatus[], report: WorkerHealthReport) => void;
}

/**
 * Polls worker state and fires `onFailure` once when any worker dies outside a
 * requested shutdown. Independent of `Worker.run()` settling: the SDK only
 * rejects `run()` after its own shutdown finalization, which is exactly the
 * step that can hang after a fatal poll error. Returns a stop function.
 */
export function startWorkerFailureWatchdog(
  workers: readonly QueueWorker[],
  options: FailureWatchdogOptions,
): () => void {
  const intervalMs = options.intervalMs ?? 5_000;
  const timer = setInterval(() => {
    if (options.isShuttingDown()) return;
    const report = reportWorkerHealth(workers, false);
    if (report.live) return;
    clearInterval(timer);
    options.onFailure(deadQueues(report), report);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
