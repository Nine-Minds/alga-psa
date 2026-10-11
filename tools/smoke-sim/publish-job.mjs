// Publishes MAINTENANCE_JOB_REQUESTED exactly as the Temporal worker's
// forwardJobToServer does (ee/temporal-workflows/src/activities/job-activities.ts).
// Usage: node publish-job.mjs <jobName> <tenantId> <integrationId>
import { randomUUID } from 'node:crypto';
import { publishEvent } from '@alga-psa/event-bus/publishers';

const [jobName, tenantId, integrationId] = process.argv.slice(2);
const jobId = `smoke-${jobName}-${randomUUID()}`;
const data = { tenantId, integrationId, provider: 'ninjaone' };
await publishEvent({
  eventType: 'MAINTENANCE_JOB_REQUESTED',
  payload: { tenantId, occurredAt: new Date().toISOString(), jobName, jobId, data },
});
console.log(JSON.stringify({ published: true, jobName, jobId }));
process.exit(0);
