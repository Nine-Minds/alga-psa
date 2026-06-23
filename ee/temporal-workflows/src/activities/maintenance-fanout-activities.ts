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

type MaintenanceFanout = (
  jobName: string,
  opts?: { concurrency?: number },
) => Promise<RunMaintenanceJobResult>;

// Runtime-only boundary into the server maintenance fan-out. The specifier is
// deliberately a widened `string` (not a literal) so the temporal-workflows
// `tsc` build does NOT pull the server maintenance-handler graph
// (billing/tickets/scheduling) into its type program — that graph blew the
// build heap. The module is resolved at activity-run time in the worker's Node
// context, where the server source is available (same as job-activities.ts).
const MAINTENANCE_FANOUT_MODULE: string =
  '../../../../server/src/lib/jobs/maintenanceJobFanout';

// Fans an existing per-tenant maintenance handler out across all tenants (or
// runs a system job once). The handler code is shared with the CE pg-boss
// runner; this just drives it from a single Temporal Schedule instead of N
// per-tenant pg-boss crons.
export async function runMaintenanceJobActivity(
  input: RunMaintenanceJobInput,
): Promise<RunMaintenanceJobResult> {
  const mod = (await import(MAINTENANCE_FANOUT_MODULE)) as {
    runMaintenanceJob: MaintenanceFanout;
  };
  return mod.runMaintenanceJob(input.jobName, { concurrency: input.concurrency });
}
