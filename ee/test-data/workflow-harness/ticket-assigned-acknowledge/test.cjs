const { randomUUID } = require('node:crypto');
const {
  deleteTenantRows,
  pickTenantOne,
  selectTenantRows
} = require('./_lib/tenant-sql.cjs');
const { ensureTenantEmailSettings } = require('./_lib/email-settings-fixture.cjs');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  const marker = '[fixture ticket-assigned-acknowledge]';

  await ensureTenantEmailSettings(ctx);

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

  const title = `Fixture assigned acknowledge ${randomUUID()}`;
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
      // Ticket deletion is blocked when comments reference the ticket; clean up those rows first.
    }

    await deleteTenantRows(ctx, { table: 'comments', where: 'ticket_id = $2', params: [ticketId] });
    await deleteTenantRows(ctx, { table: 'tickets', where: 'ticket_id = $2', params: [ticketId] });
  });

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'TICKET_ASSIGNED',
      correlationKey: ticketId,
      payloadSchemaRef: 'payload.TicketAssigned.v1',
      payload: {
        ticketId,
        updatedFields: [],
        changes: {},
        fixtureRequesterEmail: 'fixture.requester@example.com'
      }
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const steps = await ctx.getRunSteps(runRow.run_id);
  const emailStep = steps.find((s) => s.definition_step_id === 'send-email');
  ctx.expect.ok(emailStep && emailStep.status === 'SUCCEEDED', 'expected send-email step SUCCEEDED');

  const comments = await selectTenantRows(ctx, {
    table: 'comments',
    columns: 'comment_id, note, is_internal',
    where: 'ticket_id = $2',
    params: [ticketId],
    orderBy: 'created_at desc',
    limit: 25
  });

  const found = comments.find((c) => typeof c.note === 'string' && c.note.includes(marker) && c.is_internal === false);
  if (!found) {
    throw new Error(`Expected a public comment containing "${marker}" on ticket ${ticketId}. Found ${comments.length} comment(s).`);
  }
};
