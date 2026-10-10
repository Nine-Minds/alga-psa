// Publishes a bare MAINTENANCE_JOB_REQUESTED (no jobId) the way the Temporal
// maintenance-fanout schedules do, e.g. rmm-polling-reconcile.
// Usage: node publish-maintenance.mjs <jobName>
import { publishEvent } from '@alga-psa/event-bus/publishers';
const [jobName] = process.argv.slice(2);
await publishEvent({
  eventType: 'MAINTENANCE_JOB_REQUESTED',
  payload: { tenantId: '00000000-0000-0000-0000-000000000000', occurredAt: new Date().toISOString(), jobName },
});
console.log(JSON.stringify({ published: true, jobName }));
process.exit(0);
