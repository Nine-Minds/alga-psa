const { randomUUID } = require('node:crypto');
const {
  deleteTenantRows,
  insertTenantRow,
  pickTenantOne,
  selectTenantRows
} = require('../_lib/tenant-sql.cjs');
const { ensureTenantEmailSettings } = require('../_lib/email-settings-fixture.cjs');

// Needs at least two active internal users with an email address in the tenant: one becomes the
// ticket's assigned technician, the other an additional resource.

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

async function deleteTicketWithDbFallback(ctx, { ticketId, apiKey }) {
  await deleteTenantRows(ctx, { table: 'ticket_resources', where: 'ticket_id = $2', params: [ticketId] });
  try {
    await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
    return;
  } catch {
    // Ticket deletion is commonly blocked by dependent rows (e.g. comments); fall back to DB cleanup.
  }

  await deleteTenantRows(ctx, { table: 'comments', where: 'ticket_id = $2', params: [ticketId] });
  await deleteTenantRows(ctx, { table: 'tickets', where: 'ticket_id = $2', params: [ticketId] });
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  await ensureTenantEmailSettings(ctx);

  const technicians = await selectTenantRows(ctx, {
    table: 'users',
    columns: 'user_id, email',
    where: ["user_type = 'internal'", 'is_inactive = false', "coalesce(email, '') <> ''"],
    orderBy: 'created_at asc',
    limit: 2
  });
  if (technicians.length < 2) {
    throw new Error(`Fixture requires two active internal users with an email in DB (tenant=${ctx.config.tenantId}).`);
  }
  const [assigned, additional] = technicians;

  const client = await pickTenantOne(ctx, { label: 'a client', table: 'clients', columns: 'client_id', orderBy: 'created_at asc' });
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

  const createRes = await ctx.http.request('/api/v1/tickets', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    json: {
      title: `Fixture waiting email assignees ${randomUUID()}`,
      client_id: client.client_id,
      board_id: board.board_id,
      status_id: status.status_id,
      priority_id: priority.priority_id,
      assigned_to: assigned.user_id
    }
  });
  const ticketId = createRes.json?.data?.ticket_id;
  if (!ticketId) throw new Error('Ticket create response missing data.ticket_id');

  ctx.onCleanup(async () => {
    await deleteTicketWithDbFallback(ctx, { ticketId, apiKey });
  });

  // ticket_resources rows reference the ticket's assigned_to.
  await insertTenantRow(ctx, {
    table: 'ticket_resources',
    columns: ['ticket_id', 'assigned_to', 'additional_user_id', 'role'],
    values: ['$2', '$3', '$4', "'support'"],
    params: [ticketId, assigned.user_id, additional.user_id]
  });

  const waitingStatusId = status.status_id;
  const requesterEmail = 'fixture.requester@example.com';

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
        fixtureRequesterEmail: requesterEmail
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

  // The action audits the final To/Cc/Bcc counts and how many users it addressed or skipped.
  // Requester in To; assigned technician + additional resource in Cc.
  const audits = await selectTenantRows(ctx, {
    table: 'audit_logs',
    columns: 'changed_data',
    where: ["operation = 'workflow_action:email.send'", 'record_id = $2'],
    params: [runRow.run_id],
    limit: 1
  });
  ctx.expect.ok(audits.length === 1, 'expected an email.send audit row for the run');
  const changed = audits[0].changed_data;
  ctx.expect.ok(changed.to_count === 1, `expected to_count 1, got ${changed.to_count}`);
  ctx.expect.ok(changed.cc_count === 2, `expected cc_count 2 (assigned + additional), got ${changed.cc_count}`);
  ctx.expect.ok(changed.internal_user_count === 2, `expected internal_user_count 2, got ${changed.internal_user_count}`);
  ctx.expect.ok(changed.skipped_user_count === 0, `expected skipped_user_count 0, got ${changed.skipped_user_count}`);
};
