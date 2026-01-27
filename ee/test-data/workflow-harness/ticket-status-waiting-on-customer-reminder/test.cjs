const { randomUUID } = require('node:crypto');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

async function pickOne(ctx, { label, sql, params }) {
  const rows = await ctx.db.query(sql, params);
  if (!rows.length) throw new Error(`Fixture requires ${label} in DB (tenant=${ctx.config.tenantId}).`);
  return rows[0];
}

async function ensureTenantEmailSettings(ctx) {
  const tenantId = ctx.config.tenantId;

  const fixtureProviderConfigs = [
    {
      providerId: 'fixture-smtp',
      providerType: 'smtp',
      isEnabled: true,
      config: {
        host: 'imap-test-server',
        port: 3025,
        secure: false,
        username: 'imap_user',
        password: 'imap_pass',
        from: 'no-reply@example.com',
        rejectUnauthorized: false
      }
    }
  ];

  const existing = await ctx.db.query(
    `
      select
        id,
        default_from_domain,
        ticketing_from_email,
        custom_domains,
        email_provider,
        provider_configs,
        fallback_enabled,
        tracking_enabled,
        max_daily_emails,
        updated_at
      from tenant_email_settings
      where tenant = $1
      order by id asc
      limit 1
    `,
    [tenantId]
  );

  if (existing.length) {
    const row = existing[0];

    await ctx.dbWrite.query(
      `
        update tenant_email_settings
        set
          default_from_domain = $2,
          ticketing_from_email = $3,
          custom_domains = $4::json,
          email_provider = $5,
          provider_configs = $6::json,
          fallback_enabled = $7,
          tracking_enabled = $8,
          max_daily_emails = $9,
          updated_at = now()
        where id = $1
      `,
      [
        row.id,
        'example.com',
        null,
        JSON.stringify([]),
        'smtp',
        JSON.stringify(fixtureProviderConfigs),
        true,
        false,
        null
      ]
    );

    ctx.onCleanup(async () => {
      await ctx.dbWrite.query(
        `
          update tenant_email_settings
          set
            default_from_domain = $2,
            ticketing_from_email = $3,
            custom_domains = $4::json,
            email_provider = $5,
            provider_configs = $6::json,
            fallback_enabled = $7,
            tracking_enabled = $8,
            max_daily_emails = $9,
            updated_at = $10
          where id = $1
        `,
        [
          row.id,
          row.default_from_domain,
          row.ticketing_from_email,
          JSON.stringify(row.custom_domains ?? []),
          row.email_provider,
          JSON.stringify(row.provider_configs ?? []),
          row.fallback_enabled,
          row.tracking_enabled,
          row.max_daily_emails,
          row.updated_at
        ]
      );
    });

    return;
  }

  const inserted = await ctx.dbWrite.query(
    `
      insert into tenant_email_settings (
        tenant,
        default_from_domain,
        ticketing_from_email,
        custom_domains,
        email_provider,
        provider_configs,
        fallback_enabled,
        tracking_enabled,
        max_daily_emails,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4::json, $5, $6::json, $7, $8, $9, now(), now())
      returning id
    `,
    [
      tenantId,
      'example.com',
      null,
      JSON.stringify([]),
      'smtp',
      JSON.stringify(fixtureProviderConfigs),
      true,
      false,
      null
    ]
  );

  const insertedId = inserted[0]?.id;
  ctx.onCleanup(async () => {
    if (insertedId) {
      await ctx.dbWrite.query(`delete from tenant_email_settings where id = $1`, [insertedId]);
    }
  });
}

async function deleteTicketWithDbFallback(ctx, { tenantId, ticketId, apiKey }) {
  try {
    await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
    return;
  } catch {
    // Ticket deletion is commonly blocked by dependent rows (e.g. comments); fall back to DB cleanup.
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
  const marker = '[fixture ticket-status-waiting-on-customer-reminder]';

  await ensureTenantEmailSettings(ctx);

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
    sql: `select priority_id from priorities where tenant = $1 order by order_number desc limit 1`,
    params: [tenantId]
  });

  const title = `Fixture waiting reminder ${randomUUID()}`;
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
    await deleteTicketWithDbFallback(ctx, { tenantId, ticketId, apiKey });
  });

  const waitingStatusId = status.status_id;

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'TICKET_STATUS_CHANGED',
      correlationKey: ticketId,
      payloadSchemaRef: 'payload.TicketStatusChanged.v1',
      payload: {
        ticketId,
        previousStatusId: randomUUID(),
        newStatusId: waitingStatusId,
        fixtureWaitingStatusId: waitingStatusId,
        fixtureRequesterEmail: 'fixture.requester@example.com'
      }
    }
  });

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'TICKET_TIME_ENTRY_ADDED',
      correlationKey: ticketId,
      payloadSchemaRef: 'payload.TicketTimeEntryAdded.v1',
      payload: {
        ticketId,
        timeEntryId: randomUUID(),
        minutes: 1,
        billable: false
      }
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const steps = await ctx.getRunSteps(runRow.run_id);
  const emailStep = steps.find((s) => s.definition_step_id === 'send-reminder');
  ctx.expect.ok(emailStep && emailStep.status === 'SUCCEEDED', 'expected send-reminder step SUCCEEDED');
};
