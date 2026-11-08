import { randomUUID } from 'node:crypto';
import pg from 'pg';

const values = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const index = arg.indexOf('=');
  return index > 0 ? [arg.slice(0, index).replace(/^--/, ''), arg.slice(index + 1)] : [arg.replace(/^--/, ''), true];
}));
const seedTicketId = values['seed-ticket-id'];
const ticketNumber = values['ticket-number'];
const title = values.title;
if (!seedTicketId || !ticketNumber || !title) {
  throw new Error('Usage: node clone-ticket-fixture.mjs --seed-ticket-id=<ticket UUID> --ticket-number=<SLA-REVIEW-...> --title=<title> [--dry-run]');
}
if (!/^SLA-(REVIEW|REPAIR)-[A-Z0-9-]+$/.test(ticketNumber)) {
  throw new Error('Fixture ticket number must start with SLA-REVIEW- or SLA-REPAIR-.');
}

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME_SERVER,
  user: process.env.DB_USER_SERVER,
  password: process.env.DB_PASSWORD_SERVER,
});
await client.connect();
try {
  const seed = await client.query('select to_jsonb(t) as ticket from tickets t where ticket_id = $1::uuid limit 1', [seedTicketId]);
  if (!seed.rows[0]) throw new Error(`Seed ticket not found: ${seedTicketId}`);
  const source = seed.rows[0].ticket;
  if (!source.sla_policy_id || !source.priority_id || !source.board_id) {
    throw new Error('Seed ticket must have a board, SLA policy, and priority.');
  }
  const collision = await client.query('select 1 from tickets where tenant = $1::uuid and ticket_number = $2', [source.tenant, ticketNumber]);
  if (collision.rowCount) throw new Error(`Fixture ticket number already exists: ${ticketNumber}`);

  const now = new Date();
  const id = randomUUID();
  const ticket = {
    ...source,
    ticket_id: id,
    ticket_number: ticketNumber,
    title,
    url: `/msp/tickets/${id}`,
    entered_at: now.toISOString(),
    updated_at: now.toISOString(),
    closed_at: null,
    closed_by: null,
    is_closed: false,
    escalated: false,
    escalation_level: 0,
    escalated_at: null,
    escalated_by: null,
    sla_started_at: now.toISOString(),
    sla_response_due_at: null,
    sla_response_at: null,
    sla_response_met: null,
    sla_resolution_due_at: null,
    sla_resolution_at: null,
    sla_resolution_met: null,
    sla_paused_at: null,
    sla_total_pause_minutes: 0,
  };

  if (values['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, ticketId: id, ticketNumber, boardId: source.board_id, slaPolicyId: source.sla_policy_id, priorityId: source.priority_id }));
  } else {
    await client.query('insert into tickets select (jsonb_populate_record(null::tickets, $1::jsonb)).*', [JSON.stringify(ticket)]);
    console.log(JSON.stringify({ created: true, ticketId: id, ticketNumber, boardId: source.board_id, slaPolicyId: source.sla_policy_id, priorityId: source.priority_id }));
  }
} finally {
  await client.end();
}
