const { randomUUID } = require('node:crypto');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

async function pickOne(ctx, { label, sql, params }) {
  const rows = await ctx.db.query(sql, params);
  if (!rows.length) throw new Error(`Fixture requires ${label} in DB (tenant=${ctx.config.tenantId}).`);
  return rows[0];
}

async function ensureUserWithRole(ctx, { tenantId, roleName, label }) {
  const rows = await ctx.db.query(
    `
      select u.user_id
      from users u
      join user_roles ur on ur.tenant = u.tenant and ur.user_id = u.user_id
      join roles r on r.tenant = ur.tenant and r.role_id = ur.role_id
      where u.tenant = $1 and lower(r.role_name) = $2
      order by u.created_at asc
      limit 1
    `,
    [tenantId, roleName.toLowerCase()]
  );
  if (rows.length) return rows[0];

  const role = await pickOne(ctx, {
    label: `a role named "${roleName}"`,
    sql: `select role_id from roles where tenant = $1 and lower(role_name) = $2 order by created_at asc limit 1`,
    params: [tenantId, roleName.toLowerCase()]
  });

  const user = await pickOne(ctx, {
    label: label ?? `a user to assign role "${roleName}"`,
    sql: `select user_id from users where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

  await ctx.dbWrite.query(
    `
      insert into user_roles (tenant, user_id, role_id)
      values ($1, $2, $3)
      on conflict (tenant, user_id, role_id) do nothing
    `,
    [tenantId, user.user_id, role.role_id]
  );

  return user;
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
    sql: `select status_id from statuses where tenant = $1 and status_type = 'ticket' order by is_default desc, order_number asc limit 1`,
    params: [tenantId]
  });
  const priority = await pickOne(ctx, {
    label: 'a ticket priority',
    sql: `select priority_id from priorities where tenant = $1 order by order_number asc limit 1`,
    params: [tenantId]
  });
  const technician = await ensureUserWithRole(ctx, {
    tenantId,
    roleName: 'Technician',
    label: 'a user (to be assigned role=Technician)'
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
    try {
      await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey }
      });
      return;
    } catch {
      // Ticket deletion may be blocked by FK constraints; fall back to direct DB cleanup.
    }

    await ctx.dbWrite.query(`delete from tickets where tenant = $1 and ticket_id = $2`, [tenantId, ticketId]);
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
      select se.entry_id, se.title, se.work_item_type, se.work_item_id, sea.user_id, se.scheduled_start, se.scheduled_end
      from schedule_entries as se
      join schedule_entry_assignees as sea
        on sea.tenant = se.tenant and sea.entry_id = se.entry_id
      where se.tenant = $1 and sea.user_id = $2 and se.work_item_type = 'ticket' and se.work_item_id = $3
      order by se.created_at desc
      limit 10
    `,
    [tenantId, technician.user_id, ticketId]
  );

  const entry = entries.find((e) => typeof e.title === 'string' && e.title.includes(marker) && e.title.includes(appointmentId));
  if (!entry) {
    throw new Error(`Expected a schedule entry containing "${marker}" and appointmentId for ticket ${ticketId}. Found ${entries.length} entry(s).`);
  }

  ctx.onCleanup(async () => {
    try {
      await ctx.http.request(`/api/v1/schedules/${entry.entry_id}`, {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey }
      });
      return;
    } catch {
      // Schedule deletion may be blocked by FK constraints; fall back to direct DB cleanup.
    }

    await ctx.dbWrite.query(
      `delete from schedule_conflicts where tenant = $1 and (entry_id_1 = $2 or entry_id_2 = $2)`,
      [tenantId, entry.entry_id]
    );
    await ctx.dbWrite.query(`delete from schedule_entry_assignees where tenant = $1 and entry_id = $2`, [tenantId, entry.entry_id]);
    await ctx.dbWrite.query(`delete from schedule_entries where tenant = $1 and entry_id = $2`, [tenantId, entry.entry_id]);
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

  ctx.onCleanup(async () => {
    await ctx.dbWrite.query(
      `delete from internal_notifications where tenant = $1 and user_id = $2 and title like $3`,
      [tenantId, technician.user_id, `%${marker}%appointmentId=${appointmentId}%`]
    );
  });
};
