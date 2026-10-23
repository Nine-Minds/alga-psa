import type { Job } from 'pg-boss';
import { registerMaintenanceJob } from '@alga-psa/jobs/fanout';
import { slaTimerHandler } from './handlers/slaTimerHandler';
import {
  emailWebhookMaintenanceHandler,
  type EmailWebhookMaintenanceJobData,
} from './handlers/emailWebhookMaintenanceHandler';
import { CE_MAINTENANCE_JOBS } from './serverMaintenanceJobNames';

// Fan-out definitions for the jobs only Community Edition schedules through the
// maintenance fan-out. EE runs SLA on Temporal workflows and email webhook
// maintenance on emailWebhookMaintenanceWorkflow, so these are registered only
// when the edition is CE (see prepareMaintenanceRegistry).

let registered = false;

export function registerCeMaintenanceJobs(): void {
  if (registered) {
    return;
  }

  registerMaintenanceJob(CE_MAINTENANCE_JOBS.slaTimer, {
    scope: 'tenant',
    run: (tenantId) => slaTimerHandler({ tenantId }),
  });
  registerMaintenanceJob(CE_MAINTENANCE_JOBS.emailWebhookMaintenance, {
    scope: 'tenant',
    run: (tenantId) =>
      emailWebhookMaintenanceHandler({
        id: `fanout:${tenantId}`,
        data: { tenantId },
      } as Job<EmailWebhookMaintenanceJobData>),
  });

  registered = true;
}
