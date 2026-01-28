const { randomUUID } = require('node:crypto');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

async function pickOne(ctx, { label, sql, params }) {
  const rows = await ctx.db.query(sql, params);
  if (!rows.length) throw new Error(`Fixture requires ${label} in DB (tenant=${ctx.config.tenantId}).`);
  return rows[0];
}

async function deleteTicketWithDbFallback(ctx, { tenantId, ticketId, apiKey }) {
  try {
    await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
    return;
  } catch {
    // Fall back to DB cleanup for common FK constraints.
  }

  await ctx.dbWrite.query(`delete from comments where tenant = $1 and ticket_id = $2`, [tenantId, ticketId]);
  await ctx.dbWrite.query(`delete from tickets where tenant = $1 and ticket_id = $2`, [tenantId, ticketId]);
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  const tenantId = ctx.config.tenantId;
  const marker = '[fixture ticket-created-outage-escalate]';

  const client = await pickOne(ctx, {
    label: 'a client',
    sql: `select client_id from clients where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });
  const board = await pickOne(ctx, {
    label: 'a ticket board',
    sql: `select board_id from boards where tenant = $1 order by is_default desc, display_order asc limit 1`,
    params: [tenantId]
  });
  const status = await pickOne(ctx, {
    label: 'a ticket status',
    sql: `select status_id from statuses where tenant = $1 and status_type = 'ticket' order by is_default desc, order_number asc limit 1`,
    params: [tenantId]
  });
  const priority = await pickOne(ctx, {
    label: 'a ticket priority',
    sql: `select priority_id from priorities where tenant = $1 order by order_number asc limit 1`,
    params: [tenantId]
  });
  const notifyUser = await pickOne(ctx, {
    label: 'a user',
    sql: `select user_id from users where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

  const title = `Fixture outage ${randomUUID()}`;
  const createRes = await ctx.http.request('/api/v1/tickets', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    json: {
      title,
      client_id: client.client_id,
      board_id: board.board_id,
      status_id: status.status_id,
      priority_id: priority.priority_id,
      attributes: {
        fixture_is_outage: true,
        fixture_notify_user_id: notifyUser.user_id
      }
    }
  });

  const ticketId = createRes.json?.data?.ticket_id;
  if (!ticketId) throw new Error('Ticket create response missing data.ticket_id');

  ctx.onCleanup(async () => {
    await deleteTicketWithDbFallback(ctx, { tenantId, ticketId, apiKey });
  });

  ctx.onCleanup(async () => {
    await ctx.dbWrite.query(
      `
        delete from internal_notifications
        where tenant = $1
          and user_id = $2
          and message like $3
      `,
      [tenantId, notifyUser.user_id, `%${ticketId}%`]
    );
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const rows = await ctx.db.query(
    `
      select attributes
      from tickets
      where tenant = $1 and ticket_id = $2
      limit 1
    `,
    [tenantId, ticketId]
  );
  const attrs = rows[0]?.attributes ?? null;
  const attributes = typeof attrs === 'string' ? JSON.parse(attrs) : attrs;
  if (!attributes || attributes.fixture_escalated !== true) {
    throw new Error(`Expected ticket.attributes.fixture_escalated=true for ticket ${ticketId}. attributes=${JSON.stringify(attributes)}`);
  }

  const notifications = await ctx.db.query(
    `
      select internal_notification_id, title, message
      from internal_notifications
      where tenant = $1 and user_id = $2
      order by created_at desc
      limit 25
    `,
    [tenantId, notifyUser.user_id]
  );

  const found = notifications.find(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(ticketId)
  );
  if (!found) {
    throw new Error(`Expected an internal notification containing "${marker}" and ticketId for user ${notifyUser.user_id}. Found ${notifications.length} notification(s).`);
  }
};
