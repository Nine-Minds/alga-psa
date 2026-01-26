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
  const marker = '[fixture appointment-created-assign-notify]';

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
    sql: `select status_id from statuses where tenant = $1 and item_type = 'ticket' order by is_default desc, order_number asc limit 1`,
    params: [tenantId]
  });
  const priority = await pickOne(ctx, {
    label: 'a ticket priority',
    sql: `select priority_id from priorities where tenant = $1 order by order_number asc limit 1`,
    params: [tenantId]
  });
  const technician = await pickOne(ctx, {
    label: 'a technician user (role=Technician)',
    sql: `
      select u.user_id
      from users u
      join user_roles ur on ur.tenant = u.tenant and ur.user_id = u.user_id
      join roles r on r.tenant = ur.tenant and r.role_id = ur.role_id
      where u.tenant = $1 and lower(r.role_name) = 'technician'
      order by u.created_at asc
      limit 1
    `,
    params: [tenantId]
  });

  const title = `Fixture appointment assign ${randomUUID()}`;
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
    await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
  });

  const appointmentId = randomUUID();
  const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'APPOINTMENT_CREATED',
      correlationKey: appointmentId,
      payloadSchemaRef: 'payload.AppointmentCreated.v1',
      payload: {
        appointmentId,
        ticketId,
        startAt,
        endAt,
        timezone: 'UTC',
        assigneeId: technician.user_id,
        assigneeType: 'user'
      }
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const entries = await ctx.db.query(
    `
      select entry_id, title, work_item_type, work_item_id, user_id, scheduled_start, scheduled_end
      from schedule_entries
      where tenant = $1 and user_id = $2 and work_item_type = 'ticket' and work_item_id = $3
      order by created_at desc
      limit 10
    `,
    [tenantId, technician.user_id, ticketId]
  );

  const entry = entries.find((e) => typeof e.title === 'string' && e.title.includes(marker) && e.title.includes(appointmentId));
  if (!entry) {
    throw new Error(`Expected a schedule entry containing "${marker}" and appointmentId for ticket ${ticketId}. Found ${entries.length} entry(s).`);
  }

  ctx.onCleanup(async () => {
    await ctx.http.request(`/api/v1/schedules/${entry.entry_id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
  });

  const notifications = await ctx.db.query(
    `
      select internal_notification_id, title, message
      from internal_notifications
      where tenant = $1 and user_id = $2
      order by created_at desc
      limit 25
    `,
    [tenantId, technician.user_id]
  );

  const foundNotification = notifications.find(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(ticketId)
  );
  if (!foundNotification) {
    throw new Error(`Expected an internal notification containing "${marker}" and ticketId for user ${technician.user_id}. Found ${notifications.length} notification(s).`);
  }
};

