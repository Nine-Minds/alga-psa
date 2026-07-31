import { z } from 'zod';
import { BaseDomainEventPayloadSchema } from './commonEventPayloadSchemas';

// Emitted by the Temporal maintenance schedules (in the worker) to request that a
// maintenance job be run. The worker cannot run the handlers itself (they import
// Next.js-src-transpiled vertical packages that are not Node-ESM-consumable), so a
// server-side subscriber runs runMaintenanceJob(jobName), which fans the work out
// across tenants. tenantId is a nil/system UUID since the job is global.
export const maintenanceJobRequestedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  jobName: z.string().describe('Name of the job to run server-side'),
  // For global maintenance fan-out jobs (in MAINTENANCE_JOBS) jobId/data are
  // omitted and the subscriber fans out across tenants. For worker-scheduled
  // jobs that import src-consumed packages (e.g. rmm-alert-reconciliation,
  // huntress-incident-poll) the worker forwards the original jobId + data so the
  // server runs the registered handler directly for that tenant.
  jobId: z.string().optional().describe('Original job id (direct registry execution)'),
  data: z.record(z.unknown()).optional().describe('Original job data (direct registry execution)'),
}).describe('Payload for MAINTENANCE_JOB_REQUESTED');

export type MaintenanceJobRequestedEventPayload = z.infer<typeof maintenanceJobRequestedEventPayloadSchema>;
