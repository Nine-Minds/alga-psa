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

const ENQUEUER_KEY = Symbol.for('alga.core.jobEnqueuer');

type EnqueuerRegistry = typeof globalThis & {
  [ENQUEUER_KEY]?: JobEnqueuer | null;
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
