const { randomUUID } = require('node:crypto');
const {
  deleteTenantRows,
  pickTenantOne,
  selectTenantRows
} = require('./_lib/tenant-sql.cjs');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

async function deleteTicketWithDbFallback(ctx, { ticketId, apiKey }) {
  try {
    await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
    return;
  } catch {
    // Fall back to DB cleanup for common FK constraints.
  }

  await deleteTenantRows(ctx, { table: 'comments', where: 'ticket_id = $2', params: [ticketId] });
  await deleteTenantRows(ctx, { table: 'tickets', where: 'ticket_id = $2', params: [ticketId] });
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  const tenantId = ctx.config.tenantId;
  const marker = '[fixture ticket-created-notify-multiple]';

  const client = await pickTenantOne(ctx, {
    label: 'a client',
    table: 'clients',
    columns: 'client_id',
    orderBy: 'created_at asc'
  });
  const board = await pickTenantOne(ctx, {
    label: 'a ticket board',
    table: 'boards',
    columns: 'board_id',
    orderBy: 'is_default desc, display_order asc'
  });
  const status = await pickTenantOne(ctx, {
    label: 'a ticket status',
    table: 'statuses',
    columns: 'status_id',
    where: ['board_id = $2', "status_type = 'ticket'"],
    params: [board.board_id],
    orderBy: 'is_default desc, order_number asc'
  });
  const priority = await pickTenantOne(ctx, {
    label: 'a ticket priority',
    table: 'priorities',
    columns: 'priority_id',
    orderBy: 'order_number asc'
  });

  const users = await selectTenantRows(ctx, {
    table: 'users',
    columns: 'user_id',
    orderBy: 'created_at asc',
    limit: 2
  });
  if (users.length < 2) {
    throw new Error(`Fixture requires at least 2 users in DB (tenant=${tenantId}).`);
  }
  const recipientIds = [users[0].user_id, users[1].user_id];

  const title = `Fixture notify multiple ${randomUUID()}`;
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
        fixture_notify_user_ids: recipientIds
      }
    }
  });

  const ticketId = createRes.json?.data?.ticket_id;
  if (!ticketId) throw new Error('Ticket create response missing data.ticket_id');

  ctx.onCleanup(async () => {
    await deleteTicketWithDbFallback(ctx, { ticketId, apiKey });
  });

  ctx.onCleanup(async () => {
    for (const userId of recipientIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteTenantRows(ctx, {
        table: 'internal_notifications',
        where: ['user_id = $2', 'message like $3'],
        params: [userId, `%${ticketId}%`]
      });
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  for (const userId of recipientIds) {
    // eslint-disable-next-line no-await-in-loop
    const notifications = await selectTenantRows(ctx, {
      table: 'internal_notifications',
      columns: 'internal_notification_id, title, message',
      where: 'user_id = $2',
      params: [userId],
      orderBy: 'created_at desc',
      limit: 25
    });

    const found = notifications.find(
      (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(ticketId)
    );
    if (!found) {
      throw new Error(`Expected an internal notification containing "${marker}" and ticketId for user ${userId}. Found ${notifications.length} notification(s).`);
    }
  }
};
