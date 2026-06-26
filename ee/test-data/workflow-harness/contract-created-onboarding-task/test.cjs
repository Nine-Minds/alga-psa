const { randomUUID } = require('node:crypto');

const { deleteTenantRows, pickTenantOne, selectTenantRows } = require('../_lib/tenant-sql.cjs');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

async function ensureDefaultProjectStatus(ctx, { tenantId, createdByUserId }) {
  const existing = await selectTenantRows(ctx, {
    table: 'statuses',
    columns: 'status_id',
    tenantId,
    where: ["item_type = 'project'", 'is_default = true'],
    orderBy: 'order_number asc',
    limit: 1
  });
  if (existing.length) return existing[0].status_id;

  const maxRow = await selectTenantRows(ctx, {
    table: 'statuses',
    columns: 'coalesce(max(order_number), 0) as max_order',
    tenantId,
    where: "status_type = 'project'"
  });
  const nextOrder = Number(maxRow?.[0]?.max_order ?? 0) + 1;

  const name = 'Fixture Project Default';
  await ctx.dbWrite.query(
    `
      insert into statuses (tenant, name, status_type, order_number, is_closed, item_type, is_default, created_by)
      values ($1, $2, 'project', $3, false, 'project', true, $4)
      on conflict (tenant, name, status_type) do nothing
    `,
    [tenantId, name, nextOrder, createdByUserId]
  );

  const inserted = await selectTenantRows(ctx, {
    table: 'statuses',
    columns: 'status_id',
    tenantId,
    where: ['name = $2', "status_type = 'project'"],
    params: [name],
    orderBy: 'order_number asc',
    limit: 1
  });
  if (!inserted.length) throw new Error('Failed to create default project status for fixture');
  return inserted[0].status_id;
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');
  }

  const tenantId = ctx.config.tenantId;
  const marker = '[fixture contract-created-onboarding-task]';

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

  await ensureDefaultProjectStatus(ctx, { tenantId, createdByUserId: user.user_id });

  const projectName = `Fixture contract onboarding ${randomUUID()}`;
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
      table: 'interactions',
      tenantId,
      where: ['client_id = $2', 'notes like $3'],
      params: [client.client_id, `%${marker}%${contractId}%`]
    });
    await deleteTenantRows(ctx, {
      table: 'internal_notifications',
      tenantId,
      where: ['user_id = $2', '(title like $3 or message like $3)'],
      params: [user.user_id, `%${marker}%${contractId}%`]
    });
  });

  const contractId = randomUUID();
  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'CONTRACT_CREATED',
      correlationKey: contractId,
      payloadSchemaRef: 'payload.ContractCreated.v1',
      payload: {
        contractId,
        clientId: client.client_id,
        status: 'Active',
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
    from: 'project_tasks t join project_phases p on p.phase_id = t.phase_id and p.tenant = t.tenant',
    tenantAlias: 'p',
    tenantId,
    where: 'p.project_id = $2',
    params: [projectId],
    orderBy: 't.created_at desc',
    limit: 25
  });

  const taskFound = tasks.find((t) => typeof t.task_name === 'string' && t.task_name.includes(marker) && t.task_name.includes(contractId));
  if (!taskFound) {
    throw new Error(`Expected a project task containing "${marker}" and contractId on project ${projectId}. Found ${tasks.length} task(s).`);
  }

  const notes = await selectTenantRows(ctx, {
    table: 'interactions',
    columns: 'interaction_id, notes, visibility, title',
    tenantId,
    where: 'client_id = $2',
    params: [client.client_id],
    orderBy: 'interaction_date desc',
    limit: 25
  });

  const noteFound = notes.find((n) => typeof n.notes === 'string' && n.notes.includes(marker) && n.notes.includes(contractId));
  if (!noteFound) {
    throw new Error(`Expected a CRM note containing "${marker}" and contractId for client ${client.client_id}. Found ${notes.length} interaction(s).`);
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
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(contractId)
  );
  if (!notificationFound) {
    throw new Error(`Expected an internal notification containing "${marker}" and contractId for user ${user.user_id}. Found ${notifications.length} notification(s).`);
  }
};
