const { randomUUID } = require('node:crypto');

const { deleteTenantRows, pickTenantOne, selectTenantRows } = require('../_lib/tenant-sql.cjs');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  const tenantId = ctx.config.tenantId;
  const marker = '[fixture project-created-kickoff-tasks]';
  const correlationKey = randomUUID();

  const client = await pickTenantOne(ctx, {
    label: 'a client',
    table: 'clients',
    columns: 'client_id',
    tenantId,
    orderBy: 'created_at asc'
  });

  const projectName = `Fixture kickoff ${randomUUID()}`;
  const createRes = await ctx.http.request('/api/v1/projects', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    json: {
      client_id: client.client_id,
      project_name: projectName,
      create_default_phase: true
    }
  });

  const projectId = createRes.json?.data?.project_id;
  if (!projectId) throw new Error('Project create response missing data.project_id');

  ctx.onCleanup(async () => {
    const phaseIds = await selectTenantRows(ctx, {
      table: 'project_phases',
      columns: 'phase_id',
      tenantId,
      where: 'project_id = $2',
      params: [projectId]
    });
    const phaseIdList = phaseIds.map((r) => r.phase_id);

    if (phaseIdList.length) {
      const taskIds = await selectTenantRows(ctx, {
        table: 'project_tasks',
        columns: 'task_id',
        tenantId,
        where: 'phase_id = any($2::uuid[])',
        params: [phaseIdList]
      });
      const taskIdList = taskIds.map((r) => r.task_id);

      if (taskIdList.length) {
        await deleteTenantRows(ctx, {
          table: 'task_checklist_items',
          tenantId,
          where: 'task_id = any($2::uuid[])',
          params: [taskIdList]
        });
        await deleteTenantRows(ctx, {
          table: 'project_tasks',
          tenantId,
          where: 'task_id = any($2::uuid[])',
          params: [taskIdList]
        });
      }

      await deleteTenantRows(ctx, {
        table: 'project_phases',
        tenantId,
        where: 'phase_id = any($2::uuid[])',
        params: [phaseIdList]
      });
    }

    await deleteTenantRows(ctx, { table: 'project_ticket_links', tenantId, where: 'project_id = $2', params: [projectId] });
    await deleteTenantRows(ctx, { table: 'project_status_mappings', tenantId, where: 'project_id = $2', params: [projectId] });
    await deleteTenantRows(ctx, { table: 'projects', tenantId, where: 'project_id = $2', params: [projectId] });
  });

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'PROJECT_CREATED',
      correlationKey,
      payloadSchemaRef: 'payload.ProjectCreated.v1',
      payload: { projectId, fixtureName: 'project-created-kickoff-tasks', correlationKey }
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const tasks = await selectTenantRows(ctx, {
    columns: 't.task_id, t.task_name',
    from: 'project_tasks t join project_phases p on p.phase_id = t.phase_id and p.tenant = t.tenant',
    tenantAlias: 'p',
    tenantId,
    where: 'p.project_id = $2',
    params: [projectId],
    orderBy: 't.created_at desc',
    limit: 25
  });

  const found = tasks.find((t) => typeof t.task_name === 'string' && t.task_name.includes(marker));
  if (!found) {
    throw new Error(`Expected a project task containing "${marker}" on project ${projectId}. Found ${tasks.length} task(s).`);
  }
};
