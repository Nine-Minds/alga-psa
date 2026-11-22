/**
 * Job-runner accessor: lets any domain package enqueue a background job without depending on
 * @alga-psa/jobs (which sits high in the package graph and would create cycles).
 *
 * Each runtime registers the runner it actually uses (the server registers the pg-boss/Temporal
 * factory; the Temporal worker registers its own runner). Callers only need `scheduleJob`; the
 * full IJobRunner lives in @alga-psa/jobs, which re-exports these functions typed with it.
 */

export interface ScheduleJobOptions {
  runAt?: Date;
  interval?: string;
  singletonKey?: string;
  priority?: number;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ScheduleJobResult {
  jobId: string;
  externalId: string | null;
}

/** The slice of the job runner a producer needs. */
export interface JobEnqueuer {
  scheduleJob<T extends Record<string, unknown> & { tenantId: string }>(
    jobName: string,
    data: T,
    options?: ScheduleJobOptions,
  ): Promise<ScheduleJobResult>;
}

type JobRunnerAccessor<R> = () => Promise<R>;

// Same key @alga-psa/jobs has always used, so existing registrations keep working.
const ACCESSOR_KEY = Symbol.for('alga.jobs.jobRunnerAccessor');

type AccessorRegistry = typeof globalThis & {
  [ACCESSOR_KEY]?: JobRunnerAccessor<unknown> | null;
};

export function registerJobRunnerAccessor<R = JobEnqueuer>(accessor: JobRunnerAccessor<R>): void {
  (globalThis as AccessorRegistry)[ACCESSOR_KEY] = accessor;
}

export async function getJobRunner<R = JobEnqueuer>(): Promise<R> {
  const accessor = (globalThis as AccessorRegistry)[ACCESSOR_KEY];
  if (!accessor) {
    throw new Error('Job runner accessor has not been registered');
  }
  return (await accessor()) as R;
}
