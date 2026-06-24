import { runMaintenanceJob } from '@alga-psa/jobs/fanout';

export interface RunMaintenanceJobInput {
  jobName: string;
  concurrency?: number;
}

export interface RunMaintenanceJobResult {
  jobName: string;
  scope: string;
  total: number;
  succeeded: number;
  failed: number;
}

// Fans an existing per-tenant maintenance handler out across all tenants (or
// runs a system job once). The handler code is shared with the CE pg-boss
// runner via @alga-psa/jobs; this just drives it from a single Temporal
// Schedule instead of N per-tenant pg-boss crons. The fan-out runner lives in
// the shared package (no server dependency), so it is imported statically.
export async function runMaintenanceJobActivity(
  input: RunMaintenanceJobInput,
): Promise<RunMaintenanceJobResult> {
  return runMaintenanceJob(input.jobName, { concurrency: input.concurrency });
}
