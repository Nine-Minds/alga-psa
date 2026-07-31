const { randomUUID } = require('node:crypto');

const { deleteTenantRows, pickTenantOne, selectTenantRows, tenantJoin } = require('../_lib/tenant-sql.cjs');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

async function ensureUserWithRole(ctx, { tenantId, roleName, label }) {
  const rows = await selectTenantRows(ctx, {
    columns: 'u.user_id',
    from: tenantJoin(
      tenantJoin('users u', 'user_roles ur', {
        leftAlias: 'u',
        rightAlias: 'ur',
        on: 'ur.user_id = u.user_id'
      }),
      'roles r',
      {
        leftAlias: 'ur',
        rightAlias: 'r',
        on: 'r.role_id = ur.role_id'
      }
    ),
    tenantAlias: 'u',
    tenantId,
    where: 'lower(r.role_name) = $2',
    params: [roleName.toLowerCase()],
    orderBy: 'u.created_at asc',
    limit: 1
  });
  if (rows.length) return rows[0];

  const role = await pickTenantOne(ctx, {
    label: `a role named "${roleName}"`,
    table: 'roles',
    columns: 'role_id',
    tenantId,
    where: 'lower(role_name) = $2',
    params: [roleName.toLowerCase()],
    orderBy: 'created_at asc'
  });

  const user = await pickTenantOne(ctx, {
    label: label ?? `a user to assign role "${roleName}"`,
    table: 'users',
    columns: 'user_id',
    tenantId,
    orderBy: 'created_at asc'
  });

  // Intentionally raw: the fixture needs idempotent role assignment via ON CONFLICT.
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

  const client = await pickTenantOne(ctx, {
    label: 'a client',
    table: 'clients',
    columns: 'client_id',
    tenantId,
    orderBy: 'created_at asc'
  });
  const board = await pickTenantOne(ctx, {
    label: 'a ticket board',
    table: 'boards',
    columns: 'board_id',
    tenantId,
    orderBy: 'is_default desc, display_order asc'
  });
  const status = await pickTenantOne(ctx, {
    label: 'a ticket status',
    table: 'statuses',
    columns: 'status_id',
    tenantId,
    where: ['board_id = $2', "status_type = 'ticket'"],
    params: [board.board_id],
    orderBy: 'is_default desc, order_number asc'
  });
  const priority = await pickTenantOne(ctx, {
    label: 'a ticket priority',
    table: 'priorities',
    columns: 'priority_id',
    tenantId,
    orderBy: 'order_number asc'
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

    await deleteTenantRows(ctx, { table: 'tickets', tenantId, where: 'ticket_id = $2', params: [ticketId] });
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

  const entries = await selectTenantRows(ctx, {
    columns: 'se.entry_id, se.title, se.work_item_type, se.work_item_id, sea.user_id, se.scheduled_start, se.scheduled_end',
    from: tenantJoin('schedule_entries as se', 'schedule_entry_assignees as sea', {
      leftAlias: 'se',
      rightAlias: 'sea',
      on: 'sea.entry_id = se.entry_id'
    }),
    tenantAlias: 'se',
    tenantId,
    where: ['sea.user_id = $2', "se.work_item_type = 'ticket'", 'se.work_item_id = $3'],
    params: [technician.user_id, ticketId],
    orderBy: 'se.created_at desc',
    limit: 10
  });

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

    await deleteTenantRows(ctx, {
      table: 'schedule_conflicts',
      tenantId,
      where: '(entry_id_1 = $2 or entry_id_2 = $2)',
      params: [entry.entry_id]
    });
    await deleteTenantRows(ctx, { table: 'schedule_entry_assignees', tenantId, where: 'entry_id = $2', params: [entry.entry_id] });
    await deleteTenantRows(ctx, { table: 'schedule_entries', tenantId, where: 'entry_id = $2', params: [entry.entry_id] });
  });

  const notifications = await selectTenantRows(ctx, {
    table: 'internal_notifications',
    columns: 'internal_notification_id, title, message',
    tenantId,
    where: 'user_id = $2',
    params: [technician.user_id],
    orderBy: 'created_at desc',
    limit: 25
  });

  const foundNotification = notifications.find(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(ticketId)
  );
  if (!foundNotification) {
    throw new Error(`Expected an internal notification containing "${marker}" and ticketId for user ${technician.user_id}. Found ${notifications.length} notification(s).`);
  }

  ctx.onCleanup(async () => {
    await deleteTenantRows(ctx, {
      table: 'internal_notifications',
      tenantId,
      where: ['user_id = $2', 'title like $3'],
      params: [technician.user_id, `%${marker}%appointmentId=${appointmentId}%`]
    });
  });
};
