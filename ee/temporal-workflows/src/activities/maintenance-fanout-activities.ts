import { publishEvent } from '@alga-psa/event-bus/publishers';

// Nil UUID denotes a system/global event. Maintenance jobs fan out across all
// tenants server-side, so they are not tenant-scoped.
const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export interface RunMaintenanceJobInput {
  jobName: string;
  concurrency?: number;
}

export interface RunMaintenanceJobResult {
  jobName: string;
  requested: boolean;
}

// The Temporal worker runs on plain Node ESM and cannot import the maintenance
// handlers: they pull Next.js-src-transpiled vertical packages (billing,
// integrations, notifications, ...) whose dist is not Node-ESM-consumable. So
// instead of running the handler here, publish a MAINTENANCE_JOB_REQUESTED event;
// a server-side subscriber runs runMaintenanceJob(jobName), which fans the work
// out across tenants in the environment where the domain graph actually loads.
// This keeps Temporal as the durable scheduler while execution stays server-side.
export async function runMaintenanceJobActivity(
  input: RunMaintenanceJobInput,
): Promise<RunMaintenanceJobResult> {
  await publishEvent({
    eventType: 'MAINTENANCE_JOB_REQUESTED',
    payload: {
      tenantId: SYSTEM_TENANT_ID,
      occurredAt: new Date().toISOString(),
      jobName: input.jobName,
    },
  });
  return { jobName: input.jobName, requested: true };
}
