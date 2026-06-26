const { randomUUID } = require('node:crypto');

const { deleteTenantRows, pickTenantOne, selectTenantRows, tenantJoin } = require('../_lib/tenant-sql.cjs');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  const tenantId = ctx.config.tenantId;
  const marker = '[fixture schedule-block-created]';

  const client = await pickTenantOne(ctx, {
    label: 'a client',
    table: 'clients',
    columns: 'client_id',
    tenantId,
    orderBy: 'created_at asc'
  });
  const user = await pickTenantOne(ctx, {
    label: 'a user',
    table: 'users',
    columns: 'user_id',
    tenantId,
    orderBy: 'created_at asc'
  });

  const projectName = `Fixture schedule block ${randomUUID()}`;
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

  const scheduleBlockId = randomUUID();

  ctx.onCleanup(async () => {
    let projectDeleted = false;
    try {
      await ctx.http.request(`/api/v1/projects/${projectId}`, {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey }
      });
      projectDeleted = true;
    } catch {
      // Fall back to DB cleanup if project deletion fails due to FK constraints.
    }

    if (!projectDeleted) {
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
    }

    await deleteTenantRows(ctx, {
      table: 'internal_notifications',
      tenantId,
      where: ['user_id = $2', '(title like $3 or message like $3)'],
      params: [user.user_id, `%${marker}%${scheduleBlockId}%`]
    });
  });

  const startAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'SCHEDULE_BLOCK_CREATED',
      correlationKey: scheduleBlockId,
      payloadSchemaRef: 'payload.ScheduleBlockCreated.v1',
      payload: {
        scheduleBlockId,
        ownerId: user.user_id,
        ownerType: 'user',
        startAt,
        endAt,
        timezone: 'UTC',
        fixtureProjectId: projectId,
        fixtureNotifyUserId: user.user_id
      }
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const tasks = await selectTenantRows(ctx, {
    columns: 't.task_id, t.task_name',
    from: tenantJoin('project_tasks t', 'project_phases p', {
      leftAlias: 't',
      rightAlias: 'p',
      on: 'p.phase_id = t.phase_id'
    }),
    tenantAlias: 'p',
    tenantId,
    where: 'p.project_id = $2',
    params: [projectId],
    orderBy: 't.created_at desc',
    limit: 25
  });

  const taskFound = tasks.find((t) => typeof t.task_name === 'string' && t.task_name.includes(marker) && t.task_name.includes(scheduleBlockId));
  if (!taskFound) {
    throw new Error(`Expected a project task containing "${marker}" and scheduleBlockId on project ${projectId}. Found ${tasks.length} task(s).`);
  }

  const notifications = await selectTenantRows(ctx, {
    table: 'internal_notifications',
    columns: 'internal_notification_id, title, message',
    tenantId,
    where: 'user_id = $2',
    params: [user.user_id],
    orderBy: 'created_at desc',
    limit: 25
  });

  const notificationFound = notifications.find(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(scheduleBlockId)
  );
  if (!notificationFound) {
    throw new Error(`Expected an internal notification containing "${marker}" and scheduleBlockId for user ${user.user_id}. Found ${notifications.length} notification(s).`);
  }
};
