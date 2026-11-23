import pg from 'pg';

const ticketIds = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const watch = process.argv.includes('--watch');
if (ticketIds.length === 0) throw new Error('Usage: node inspect-sla-audit.mjs [--watch] <ticket UUID> [ticket UUID ...]');
const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME_SERVER,
  user: process.env.DB_USER_SERVER,
  password: process.env.DB_PASSWORD_SERVER,
});
await client.connect();
try {
  const lastByAudit = new Map();
  do {
    const { rows } = await client.query(`
      select l.ticket_id, t.ticket_number, l.log_id, l.created_at,
        l.event_data #>> '{notifications,email}' as email_outcome,
        l.event_data #>> '{notifications,emailMessageId}' as message_id,
        l.event_data #>> '{notifications,emailReason}' as email_error
      from sla_audit_log l
      join tickets t on t.tenant = l.tenant and t.ticket_id = l.ticket_id
      where l.ticket_id = any($1::uuid[])
      order by l.created_at, l.log_id
    `, [ticketIds]);
    for (const row of rows) {
      const line = JSON.stringify(row);
      const key = `${row.ticket_id}:${row.log_id}`;
      const signature = `${row.email_outcome}:${row.message_id}:${row.email_error}`;
      if (!watch || signature !== lastByAudit.get(key)) console.log(line);
      lastByAudit.set(key, signature);
    }
    const terminalTickets = new Set(rows.filter((row) => ['sent', 'failed', 'skipped'].includes(row.email_outcome)).map((row) => row.ticket_id));
    if (!watch || ticketIds.every((id) => terminalTickets.has(id))) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
} finally {
  await client.end();
}
