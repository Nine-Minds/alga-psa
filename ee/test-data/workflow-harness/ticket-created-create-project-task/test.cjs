const { randomUUID } = require('node:crypto');

const {
  deleteTenantRows,
  pickTenantOne,
  selectTenantRows,
  tenantEquals,
  tenantJoin,
  tenantWhere
} = require('../_lib/tenant-sql.cjs');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

function projectTasksWithPhasesFrom() {
  return tenantJoin('project_tasks t', 'project_phases p', {
    leftAlias: 't',
    rightAlias: 'p',
    on: 'p.phase_id = t.phase_id'
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
    // Fall back to DB cleanup for common FK constraints (e.g. project_ticket_links, comments).
  }

  await deleteTenantRows(ctx, { table: 'project_ticket_links', tenantId, where: 'ticket_id = $2', params: [ticketId] });
  await deleteTenantRows(ctx, { table: 'comments', tenantId, where: 'ticket_id = $2', params: [ticketId] });
  await deleteTenantRows(ctx, { table: 'tickets', tenantId, where: 'ticket_id = $2', params: [ticketId] });
}

async function deleteProjectWithDbFallback(ctx, { tenantId, projectId, apiKey }) {
  try {
    await ctx.http.request(`/api/v1/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
    return;
  } catch {
    // Fall back to DB cleanup for common FK constraints (phases/tasks/links).
  }

  // Remove any ticket links first (FKs to tickets/projects/tasks/phases).
  await deleteTenantRows(ctx, { table: 'project_ticket_links', tenantId, where: 'project_id = $2', params: [projectId] });

  // Intentionally raw: helper wrappers do not model DELETE USING/CTE cleanup.
  await ctx.dbWrite.query(
    `
      with project_tasks_in_project as (
        select t.task_id
        from ${projectTasksWithPhasesFrom()}
        where ${tenantWhere('p')} and p.project_id = $2
      )
      delete from project_task_dependencies d
      using project_tasks_in_project pt
      where ${tenantWhere('d')}
        and (d.predecessor_task_id = pt.task_id or d.successor_task_id = pt.task_id)
    `,
    [tenantId, projectId]
  );

  // Intentionally raw: DELETE USING removes all tasks under project phases in one cleanup query.
  await ctx.dbWrite.query(
    `
      delete from project_tasks t
      using project_phases p
      where ${tenantWhere('t')}
        and ${tenantEquals('p', 't')}
        and p.phase_id = t.phase_id
        and p.project_id = $2
    `,
    [tenantId, projectId]
  );

  await deleteTenantRows(ctx, { table: 'project_materials', tenantId, where: 'project_id = $2', params: [projectId] });
  await deleteTenantRows(ctx, { table: 'project_phases', tenantId, where: 'project_id = $2', params: [projectId] });
  await deleteTenantRows(ctx, { table: 'projects', tenantId, where: 'project_id = $2', params: [projectId] });
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  const tenantId = ctx.config.tenantId;
  const marker = '[fixture ticket-created-create-project-task]';

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
    await deleteProjectWithDbFallback(ctx, { tenantId, projectId, apiKey });
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
    await deleteTicketWithDbFallback(ctx, { tenantId, ticketId, apiKey });
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const tasks = await selectTenantRows(ctx, {
    columns: 't.task_id, t.task_name',
    from: projectTasksWithPhasesFrom(),
    tenantAlias: 'p',
    tenantId,
    where: 'p.project_id = $2',
    params: [projectId],
    orderBy: 't.created_at desc',
    limit: 25
  });

  const found = tasks.find((t) => typeof t.task_name === 'string' && t.task_name.includes(marker) && t.task_name.includes(ticketId));
  if (!found) {
    throw new Error(`Expected a project task containing "${marker}" and ticketId on project ${projectId}. Found ${tasks.length} task(s).`);
  }
};
