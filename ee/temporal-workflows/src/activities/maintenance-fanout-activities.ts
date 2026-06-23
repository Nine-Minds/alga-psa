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
// runner; this just drives it from a single Temporal Schedule instead of N
// per-tenant pg-boss crons. Imported dynamically (cross-package into server).
export async function runMaintenanceJobActivity(
  input: RunMaintenanceJobInput,
): Promise<RunMaintenanceJobResult> {
  const { runMaintenanceJob } = await import(
    '../../../../server/src/lib/jobs/maintenanceJobFanout'
  );
  return runMaintenanceJob(input.jobName, { concurrency: input.concurrency });
}
