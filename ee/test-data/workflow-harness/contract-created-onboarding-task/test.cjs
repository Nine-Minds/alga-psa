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
  const marker = '[fixture contract-created-onboarding-task]';

  const client = await pickOne(ctx, {
    label: 'a client',
    sql: `select client_id from clients where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });
  const user = await pickOne(ctx, {
    label: 'a user',
    sql: `select user_id from users where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

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
    await ctx.http.request(`/api/v1/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
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

  const taskFound = tasks.find((t) => typeof t.task_name === 'string' && t.task_name.includes(marker) && t.task_name.includes(contractId));
  if (!taskFound) {
    throw new Error(`Expected a project task containing "${marker}" and contractId on project ${projectId}. Found ${tasks.length} task(s).`);
  }

  const notes = await ctx.db.query(
    `
      select interaction_id, notes, visibility, title
      from interactions
      where tenant = $1 and client_id = $2
      order by interaction_date desc
      limit 25
    `,
    [tenantId, client.client_id]
  );

  const noteFound = notes.find((n) => typeof n.notes === 'string' && n.notes.includes(marker) && n.notes.includes(contractId));
  if (!noteFound) {
    throw new Error(`Expected a CRM note containing "${marker}" and contractId for client ${client.client_id}. Found ${notes.length} interaction(s).`);
  }

  const notifications = await ctx.db.query(
    `
      select internal_notification_id, title, message
      from internal_notifications
      where tenant = $1 and user_id = $2
      order by created_at desc
      limit 25
    `,
    [tenantId, user.user_id]
  );

  const notificationFound = notifications.find(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(contractId)
  );
  if (!notificationFound) {
    throw new Error(`Expected an internal notification containing "${marker}" and contractId for user ${user.user_id}. Found ${notifications.length} notification(s).`);
  }
};

