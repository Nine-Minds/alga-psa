// Horizontal DI seam for enqueuing background jobs. Lets vertical feature
// packages (billing, client-portal) schedule jobs without importing
// @alga-psa/jobs (whose JobService would create a vertical -> jobs cycle, since
// @alga-psa/jobs holds the cross-domain handlers). The server registers the real
// JobService-backed implementation at startup. Mirrors registerJobRunnerAccessor.
export interface JobEnqueueResult {
  jobId: string;
  scheduledJobId: string | null;
}

type JobEnqueuer = (
  jobName: string,
  data: Record<string, unknown>,
) => Promise<JobEnqueueResult>;

/** Scheduling options passed through the seam to the underlying job runner. */
export interface ScheduleJobAtOptions {
  /** Unique key to collapse duplicate scheduled jobs (singleton behavior). */
  singletonKey?: string;
  /** Additional metadata persisted with the job. */
  metadata?: Record<string, unknown>;
}

type ScheduledJobEnqueuer = (
  jobName: string,
  data: Record<string, unknown>,
  runAt: Date,
  options?: ScheduleJobAtOptions,
) => Promise<JobEnqueueResult>;

type ScheduledJobCanceler = (
  jobId: string,
  tenantId: string,
) => Promise<boolean>;

const ENQUEUER_KEY = Symbol.for('alga.core.jobEnqueuer');
const SCHEDULED_ENQUEUER_KEY = Symbol.for('alga.core.scheduledJobEnqueuer');
const SCHEDULED_CANCELER_KEY = Symbol.for('alga.core.scheduledJobCanceler');

type EnqueuerRegistry = typeof globalThis & {
  [ENQUEUER_KEY]?: JobEnqueuer | null;
  [SCHEDULED_ENQUEUER_KEY]?: ScheduledJobEnqueuer | null;
  [SCHEDULED_CANCELER_KEY]?: ScheduledJobCanceler | null;
};

export function registerJobEnqueuer(enqueuer: JobEnqueuer): void {
  (globalThis as EnqueuerRegistry)[ENQUEUER_KEY] = enqueuer;
}

export async function enqueueImmediateJob(
  jobName: string,
  data: Record<string, unknown>,
): Promise<JobEnqueueResult> {
  const enqueuer = (globalThis as EnqueuerRegistry)[ENQUEUER_KEY];
  if (!enqueuer) {
    throw new Error('Job enqueuer has not been registered');
  }
  return enqueuer(jobName, data);
}

export function registerScheduledJobEnqueuer(enqueuer: ScheduledJobEnqueuer): void {
  (globalThis as EnqueuerRegistry)[SCHEDULED_ENQUEUER_KEY] = enqueuer;
}

/**
 * Schedule a background job to run at a future instant without importing
 * @alga-psa/jobs. The server registers the runner-backed implementation at
 * startup; the returned jobId is the durable jobs-table id used to cancel later.
 */
export async function scheduleJobAt(
  jobName: string,
  data: Record<string, unknown>,
  runAt: Date,
  options?: ScheduleJobAtOptions,
): Promise<JobEnqueueResult> {
  const enqueuer = (globalThis as EnqueuerRegistry)[SCHEDULED_ENQUEUER_KEY];
  if (!enqueuer) {
    throw new Error('Scheduled job enqueuer has not been registered');
  }
  return enqueuer(jobName, data, runAt, options);
}

export function registerScheduledJobCanceler(canceler: ScheduledJobCanceler): void {
  (globalThis as EnqueuerRegistry)[SCHEDULED_CANCELER_KEY] = canceler;
}

/** Cancel a previously scheduled job by its durable jobs-table id. */
export async function cancelScheduledJob(
  jobId: string,
  tenantId: string,
): Promise<boolean> {
  const canceler = (globalThis as EnqueuerRegistry)[SCHEDULED_CANCELER_KEY];
  if (!canceler) {
    throw new Error('Scheduled job canceler has not been registered');
  }
  return canceler(jobId, tenantId);
}
