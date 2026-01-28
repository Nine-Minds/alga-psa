const { randomUUID } = require('node:crypto');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

async function pickOne(ctx, { label, sql, params }) {
  const rows = await ctx.db.query(sql, params);
  if (!rows.length) throw new Error(`Fixture requires ${label} in DB (tenant=${ctx.config.tenantId}).`);
  return rows[0];
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  const tenantId = ctx.config.tenantId;
  const marker = '[fixture ticket-created-assign-trycatch]';

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
    label: 'a user (notification recipient)',
    sql: `select user_id from users where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

  const title = `Fixture assign trycatch ${randomUUID()}`;
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
        fixture_notify_user_id: notifyUser.user_id,
        fixture_bad_assignee_user_id: randomUUID()
      }
    }
  });

  const ticketId = createRes.json?.data?.ticket_id;
  if (!ticketId) throw new Error('Ticket create response missing data.ticket_id');

  ctx.onCleanup(async () => {
    try {
      await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey }
      });
      return;
    } catch {
      // Ticket deletion is blocked when comments reference the ticket; clean up those rows first.
    }

    await ctx.dbWrite.query(`delete from comments where tenant = $1 and ticket_id = $2`, [tenantId, ticketId]);
    await ctx.dbWrite.query(`delete from tickets where tenant = $1 and ticket_id = $2`, [tenantId, ticketId]);
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const comments = await ctx.db.query(
    `
      select comment_id, note, is_internal
      from comments
      where tenant = $1 and ticket_id = $2
      order by created_at desc
      limit 25
    `,
    [tenantId, ticketId]
  );

  const commentFound = comments.find((c) => typeof c.note === 'string' && c.note.includes(marker) && c.note.includes(ticketId) && c.is_internal === true);
  if (!commentFound) {
    throw new Error(`Expected an internal comment containing "${marker}" and ticketId on ticket ${ticketId}. Found ${comments.length} comment(s).`);
  }
};
