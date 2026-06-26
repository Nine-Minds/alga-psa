const { randomUUID } = require('node:crypto');
const { deleteTenantRows, pickTenantOne, selectTenantRows } = require('../_lib/tenant-sql.cjs');

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

  const marker = '[fixture ticket-escalated-crm-note]';

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
    orderBy: 'order_number desc'
  });
  const user = await pickTenantOne(ctx, {
    label: 'a user',
    table: 'users',
    columns: 'user_id',
    orderBy: 'created_at asc'
  });

  const title = `Fixture escalated crm note ${randomUUID()}`;
  const createRes = await ctx.http.request('/api/v1/tickets', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    json: {
      title,
      client_id: client.client_id,
      board_id: board.board_id,
      status_id: status.status_id,
      priority_id: priority.priority_id
    }
  });
  const ticketId = createRes.json?.data?.ticket_id;
  if (!ticketId) throw new Error('Ticket create response missing data.ticket_id');

  ctx.onCleanup(async () => {
    await deleteTicketWithDbFallback(ctx, { ticketId, apiKey });
  });

  ctx.onCleanup(async () => {
    await deleteTenantRows(ctx, {
      table: 'interactions',
      where: ['client_id = $2', 'notes like $3'],
      params: [client.client_id, `%${ticketId}%`]
    });
  });

  ctx.onCleanup(async () => {
    await deleteTenantRows(ctx, {
      table: 'internal_notifications',
      where: ['user_id = $2', 'message like $3'],
      params: [user.user_id, `%${ticketId}%`]
    });
  });

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'TICKET_ESCALATED',
      correlationKey: ticketId,
      payloadSchemaRef: 'payload.TicketEscalated.v1',
      payload: {
        ticketId,
        fromQueueId: randomUUID(),
        toQueueId: randomUUID(),
        fixtureClientId: client.client_id,
        fixtureNotifyUserId: user.user_id
      }
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const notes = await selectTenantRows(ctx, {
    table: 'interactions',
    columns: 'interaction_id, notes',
    where: 'client_id = $2',
    params: [client.client_id],
    orderBy: 'interaction_date desc',
    limit: 25
  });
  const noteFound = notes.find((n) => typeof n.notes === 'string' && n.notes.includes(marker) && n.notes.includes(ticketId));
  if (!noteFound) {
    throw new Error(`Expected a CRM note containing "${marker}" and ticketId on client ${client.client_id}. Found ${notes.length} note(s).`);
  }

  const notifications = await selectTenantRows(ctx, {
    table: 'internal_notifications',
    columns: 'internal_notification_id, title, message',
    where: 'user_id = $2',
    params: [user.user_id],
    orderBy: 'created_at desc',
    limit: 25
  });
  const notificationFound = notifications.find(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(ticketId)
  );
  if (!notificationFound) {
    throw new Error(`Expected an internal notification containing "${marker}" and ticketId for user ${user.user_id}. Found ${notifications.length} notification(s).`);
  }
};
