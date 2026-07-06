import type { IJobRunner } from './jobs/interfaces';

// Decouples shared job handlers from the concrete JobRunnerFactory, which is
// server-bound (PgBossJobRunner pulls JobService/StorageService/knexfile). Each
// runtime registers the runner it actually uses: the CE/EE server registers the
// real factory (pg-boss or Temporal by edition); the Temporal worker registers
// the Temporal runner directly. Mirrors registerWorkflowScheduleJobRunner.
type JobRunnerAccessor = () => Promise<IJobRunner>;

const ACCESSOR_KEY = Symbol.for('alga.jobs.jobRunnerAccessor');

type AccessorRegistry = typeof globalThis & {
  [ACCESSOR_KEY]?: JobRunnerAccessor | null;
};

export function registerJobRunnerAccessor(accessor: JobRunnerAccessor): void {
  (globalThis as AccessorRegistry)[ACCESSOR_KEY] = accessor;
}

export async function getJobRunner(): Promise<IJobRunner> {
  const accessor = (globalThis as AccessorRegistry)[ACCESSOR_KEY];
  if (!accessor) {
    throw new Error('Job runner accessor has not been registered');
  }
  return accessor();
}
