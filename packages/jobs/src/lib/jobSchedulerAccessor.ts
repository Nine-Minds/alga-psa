import type { IJobScheduler } from './jobs/jobScheduler';

// Decouples the package's CE scheduling helpers from server/src/lib/jobs, whose
// initializeScheduler() bootstraps the full server handler registry (invoice,
// asset-import, email, etc.) and therefore cannot be imported here without
// dragging server-only modules into the Temporal worker build. The server
// registers its initializeScheduler as the accessor; the package consumes it.
// Mirrors registerJobRunnerAccessor in jobRunnerAccessor.ts.
type SchedulerAccessor = () => Promise<IJobScheduler | null | undefined>;

const ACCESSOR_KEY = Symbol.for('alga.jobs.jobSchedulerAccessor');

type AccessorRegistry = typeof globalThis & {
  [ACCESSOR_KEY]?: SchedulerAccessor | null;
};

export function registerJobSchedulerAccessor(accessor: SchedulerAccessor): void {
  (globalThis as AccessorRegistry)[ACCESSOR_KEY] = accessor;
}

export async function getJobScheduler(): Promise<IJobScheduler | null> {
  const accessor = (globalThis as AccessorRegistry)[ACCESSOR_KEY];
  if (!accessor) {
    return null;
  }
  return (await accessor()) ?? null;
}
