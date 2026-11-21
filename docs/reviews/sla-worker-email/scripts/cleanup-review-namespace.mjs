import { Client, Connection } from '@temporalio/client';

const namespace = process.argv[2];
const apply = process.argv.includes('--apply');
if (namespace !== 'sla-email-repair-20261108') {
  throw new Error('This cleanup helper is restricted to the dedicated repair namespace sla-email-repair-20261108.');
}
if (!process.env.TEMPORAL_ADDRESS) throw new Error('TEMPORAL_ADDRESS is required');
const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
try {
  const temporal = new Client({ connection, namespace });
  const schedules = [];
  for await (const item of temporal.schedule.list()) schedules.push(item.scheduleId);
  const running = [];
  for await (const item of temporal.workflow.list({ query: 'ExecutionStatus="Running"' })) {
    running.push({ workflowId: item.workflowId, workflowType: item.type });
  }
  console.log(JSON.stringify({ namespace, apply, schedules, running }));
  if (apply) {
    for (const id of schedules) await temporal.schedule.getHandle(id).delete();
    for (const item of running) await temporal.workflow.getHandle(item.workflowId).terminate('SLA review cleanup');
  }
} finally {
  await connection.close();
}
