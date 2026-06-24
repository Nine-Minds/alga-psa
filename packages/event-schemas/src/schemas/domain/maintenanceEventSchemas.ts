import { z } from 'zod';
import { BaseDomainEventPayloadSchema } from './commonEventPayloadSchemas';

// Emitted by the Temporal maintenance schedules (in the worker) to request that a
// maintenance job be run. The worker cannot run the handlers itself (they import
// Next.js-src-transpiled vertical packages that are not Node-ESM-consumable), so a
// server-side subscriber runs runMaintenanceJob(jobName), which fans the work out
// across tenants. tenantId is a nil/system UUID since the job is global.
export const maintenanceJobRequestedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  jobName: z.string().describe('Name of the maintenance job to run (fans out across tenants server-side)'),
}).describe('Payload for MAINTENANCE_JOB_REQUESTED');

export type MaintenanceJobRequestedEventPayload = z.infer<typeof maintenanceJobRequestedEventPayloadSchema>;
