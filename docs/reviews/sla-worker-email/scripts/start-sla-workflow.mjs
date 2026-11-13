import pg from 'pg';
import { Client, Connection } from '@temporalio/client';

const ticketId = process.argv[2];
if (!ticketId) throw new Error('Usage: node start-sla-workflow.mjs <ticket UUID>');
for (const name of ['TEMPORAL_ADDRESS', 'TEMPORAL_NAMESPACE']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'sla-workflows';
const db = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME_SERVER,
  user: process.env.DB_USER_SERVER,
  password: process.env.DB_PASSWORD_SERVER,
});
await db.connect();
let connection;
try {
  const result = await db.query(`
    select k.tenant, k.ticket_id, p.policy_name,
      target.target_id, target.sla_policy_id, target.priority_id,
      target.response_time_minutes, target.resolution_time_minutes,
      target.escalation_1_percent, target.escalation_2_percent,
      target.escalation_3_percent, target.is_24x7
    from tickets k
    join sla_policies p on p.tenant = k.tenant and p.sla_policy_id = k.sla_policy_id
    join sla_policy_targets target on target.tenant = k.tenant
      and target.sla_policy_id = k.sla_policy_id and target.priority_id = k.priority_id
    where k.ticket_id = $1::uuid
  `, [ticketId]);
  if (result.rowCount !== 1) throw new Error(`Expected one ticket and matching SLA target; found ${result.rowCount}`);
  const row = result.rows[0];
  if (!row.is_24x7) throw new Error('This review runner supports the review 24x7 fixture policy only.');
  const schedule = {
    tenant: row.tenant,
    schedule_id: `review-24x7-${row.tenant}`,
    schedule_name: 'Review 24x7',
    timezone: 'UTC',
    is_default: false,
    is_24x7: true,
    entries: [],
    holidays: [],
  };
  const input = {
    ticketId: row.ticket_id,
    tenantId: row.tenant,
    policyTargets: [{
      tenant: row.tenant,
      target_id: row.target_id,
      sla_policy_id: row.sla_policy_id,
      priority_id: row.priority_id,
      response_time_minutes: row.response_time_minutes,
      resolution_time_minutes: row.resolution_time_minutes,
      escalation_1_percent: row.escalation_1_percent,
      escalation_2_percent: row.escalation_2_percent,
      escalation_3_percent: row.escalation_3_percent,
      is_24x7: row.is_24x7,
    }],
    businessHoursSchedule: schedule,
  };
  connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
  const temporal = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE });
  const workflowId = `sla-ticket-${row.tenant}-${row.ticket_id}`;
  const handle = await temporal.workflow.start('slaTicketWorkflow', {
    args: [input],
    taskQueue,
    workflowId,
    workflowExecutionTimeout: '365d',
  });
  console.log(JSON.stringify({ started: true, workflowId: handle.workflowId, namespace: process.env.TEMPORAL_NAMESPACE, taskQueue, ticketId, policy: row.policy_name, responseMinutes: row.response_time_minutes }));
} finally {
  await db.end();
  await connection?.close();
}
