import type { IJobRunner } from './jobs/interfaces';
import {
  getJobRunner as getRegisteredJobRunner,
  registerJobRunnerAccessor as registerAccessor,
} from '@alga-psa/core/jobRunnerAccessor';

// Decouples shared job handlers from the concrete JobRunnerFactory, which is
// server-bound (PgBossJobRunner pulls JobService/StorageService/knexfile). Each
// runtime registers the runner it actually uses: the CE/EE server registers the
// real factory (pg-boss or Temporal by edition); the Temporal worker registers
// the Temporal runner directly. The registry itself lives in @alga-psa/core so
// domain packages can enqueue jobs without depending on this package; these
// wrappers only add the full IJobRunner type.
export function registerJobRunnerAccessor(accessor: () => Promise<IJobRunner>): void {
  registerAccessor<IJobRunner>(accessor);
}

export async function getJobRunner(): Promise<IJobRunner> {
  return getRegisteredJobRunner<IJobRunner>();
}
