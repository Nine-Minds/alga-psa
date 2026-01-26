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
  const marker = '[fixture ticket-created-create-project-task]';

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

  const projectName = `Fixture onboarding project ${randomUUID()}`;
  const createProjectRes = await ctx.http.request('/api/v1/projects', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    json: {
      client_id: client.client_id,
      project_name: projectName,
      create_default_phase: true
    }
  });

  const projectId = createProjectRes.json?.data?.project_id;
  if (!projectId) throw new Error('Project create response missing data.project_id');

  ctx.onCleanup(async () => {
    await ctx.http.request(`/api/v1/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
  });

  const title = `Fixture onboarding ticket ${randomUUID()}`;
  const createTicketRes = await ctx.http.request('/api/v1/tickets', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    json: {
      title,
      client_id: client.client_id,
      board_id: board.board_id,
      status_id: status.status_id,
      priority_id: priority.priority_id,
      attributes: {
        fixture_project_id: projectId
      }
    }
  });

  const ticketId = createTicketRes.json?.data?.ticket_id;
  if (!ticketId) throw new Error('Ticket create response missing data.ticket_id');

  ctx.onCleanup(async () => {
    await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const tasks = await ctx.db.query(
    `
      select t.task_id, t.task_name
      from project_tasks t
      join project_phases p on p.phase_id = t.phase_id and p.tenant = t.tenant
      where p.tenant = $1 and p.project_id = $2
      order by t.created_at desc
      limit 25
    `,
    [tenantId, projectId]
  );

  const found = tasks.find((t) => typeof t.task_name === 'string' && t.task_name.includes(marker) && t.task_name.includes(ticketId));
  if (!found) {
    throw new Error(`Expected a project task containing "${marker}" and ticketId on project ${projectId}. Found ${tasks.length} task(s).`);
  }
};
