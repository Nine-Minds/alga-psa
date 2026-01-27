const { randomUUID } = require('node:crypto');

const { buildBasePayloadForEvent, pickOne, pickUser } = require('./notification-fixture.cjs');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

function ticketIdExprForEvent(eventName) {
  if (eventName === 'TICKET_MERGED') return 'payload.sourceTicketId';
  if (eventName === 'TICKET_SPLIT') return 'payload.originalTicketId';
  return 'payload.ticketId';
}

function projectIdExprForEvent(eventName) {
  if (String(eventName || '').startsWith('PROJECT_')) return 'payload.projectId';
  if (eventName === 'TASK_COMMENT_ADDED' || eventName === 'TASK_COMMENT_UPDATED') return 'payload.projectId';
  if (String(eventName || '').startsWith('INVOICE_')) return 'payload.invoiceId';
  if (String(eventName || '').startsWith('PAYMENT_')) return 'payload.paymentId';
  if (String(eventName || '').startsWith('CONTRACT_')) return 'payload.contractId';
  if (String(eventName || '').startsWith('COMPANY_')) return 'payload.companyId';
  if (String(eventName || '').startsWith('APPOINTMENT_')) return 'payload.appointmentId';
  if (String(eventName || '').startsWith('TECHNICIAN_')) return 'payload.appointmentId';
  if (String(eventName || '').startsWith('TIME_ENTRY_')) return 'payload.timeEntryId';
  if (String(eventName || '').startsWith('SCHEDULE_BLOCK_')) return 'payload.scheduleBlockId';
  if (String(eventName || '').startsWith('SCHEDULE_ENTRY_')) return 'payload.entryId';
  if (eventName === 'CAPACITY_THRESHOLD_REACHED') return 'payload.teamId';
  if (String(eventName || '').startsWith('INTEGRATION_')) return 'payload.integrationId';
  if (eventName === 'EMAIL_PROVIDER_CONNECTED') return 'payload.providerId';
  return 'payload.projectId';
}

function ensureCallWorkflowInputMapping(callStep, { kind, eventName }) {
  if (!callStep || typeof callStep !== 'object') throw new Error('ensureCallWorkflowInputMapping requires a call step object');

  const inputMapping =
    callStep.inputMapping && typeof callStep.inputMapping === 'object' && !Array.isArray(callStep.inputMapping) ? callStep.inputMapping : {};
  // eslint-disable-next-line no-param-reassign
  callStep.inputMapping = inputMapping;

  if (kind === 'ticket_comment') {
    const idExpr = ticketIdExprForEvent(eventName);
    const match = /^payload\.(\w+)$/.exec(idExpr);
    const field = match ? match[1] : 'ticketId';
    inputMapping[field] = { $expr: idExpr };
    return;
  }

  if (kind === 'project_task') {
    const idExpr = projectIdExprForEvent(eventName);
    const match = /^payload\.(\w+)$/.exec(idExpr);
    const field = match ? match[1] : 'projectId';
    inputMapping[field] = { $expr: idExpr };
    return;
  }

  throw new Error(`Unknown callWorkflow kind: ${kind}`);
}

async function assertRunSucceeded(ctx, runRow) {
  if (runRow.status === 'SUCCEEDED') return;
  const steps = await ctx.getRunSteps(runRow.run_id);
  throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
}

async function createProject(ctx, { tenantId, apiKey, clientId }) {
  const projectName = `Fixture project ${randomUUID()}`;
  const createRes = await ctx.http.request('/api/v1/projects', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    json: {
      client_id: clientId,
      project_name: projectName,
      create_default_phase: true
    }
  });

  const projectId = createRes.json?.data?.project_id;
  if (!projectId) throw new Error('Project create response missing data.project_id');
  return projectId;
}

async function cleanupProject(ctx, { tenantId, apiKey, projectId }) {
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

  if (projectDeleted) return;

  const phaseIds = await ctx.db.query(`select phase_id from project_phases where tenant = $1 and project_id = $2`, [tenantId, projectId]);
  const phaseIdList = phaseIds.map((r) => r.phase_id);

  if (phaseIdList.length) {
    const taskIds = await ctx.db.query(`select task_id from project_tasks where tenant = $1 and phase_id = any($2::uuid[])`, [
      tenantId,
      phaseIdList
    ]);
    const taskIdList = taskIds.map((r) => r.task_id);

    if (taskIdList.length) {
      await ctx.dbWrite.query(`delete from task_checklist_items where tenant = $1 and task_id = any($2::uuid[])`, [tenantId, taskIdList]);
      await ctx.dbWrite.query(`delete from project_tasks where tenant = $1 and task_id = any($2::uuid[])`, [tenantId, taskIdList]);
    }

    await ctx.dbWrite.query(`delete from project_phases where tenant = $1 and phase_id = any($2::uuid[])`, [tenantId, phaseIdList]);
  }

  await ctx.dbWrite.query(`delete from project_ticket_links where tenant = $1 and project_id = $2`, [tenantId, projectId]);
  await ctx.dbWrite.query(`delete from project_status_mappings where tenant = $1 and project_id = $2`, [tenantId, projectId]);
  await ctx.dbWrite.query(`delete from projects where tenant = $1 and project_id = $2`, [tenantId, projectId]);
}

async function createTicket(ctx, { tenantId, apiKey }) {
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

  const title = `Fixture ticket ${randomUUID()}`;

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
  return ticketId;
}

async function cleanupTicket(ctx, { tenantId, apiKey, ticketId }) {
  try {
    await ctx.http.request(`/api/v1/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey }
    });
    return;
  } catch {
    // Ticket deletion is blocked when comments reference the ticket; clean up those rows first.
  }

  await ctx.dbWrite.query(`delete from comments where tenant = $1 and ticket_id = $2`, [tenantId, ticketId]);
  await ctx.dbWrite.query(`delete from tickets where tenant = $1 and ticket_id = $2`, [tenantId, ticketId]);
}

async function listTicketComments(ctx, { tenantId, ticketId, limit = 50 }) {
  return ctx.db.query(
    `
      select comment_id, note, is_internal, metadata, created_at
      from comments
      where tenant = $1 and ticket_id = $2
      order by created_at desc
      limit ${Number(limit) || 50}
    `,
    [tenantId, ticketId]
  );
}

async function listProjectTasks(ctx, { tenantId, projectId, limit = 50 }) {
  return ctx.db.query(
    `
      select t.task_id, t.task_name, t.created_at
      from project_tasks t
      join project_phases p on p.phase_id = t.phase_id and p.tenant = t.tenant
      where p.tenant = $1 and p.project_id = $2
      order by t.created_at desc
      limit ${Number(limit) || 50}
    `,
    [tenantId, projectId]
  );
}

async function triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload }) {
  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName,
      correlationKey,
      payloadSchemaRef: schemaRef,
      payload
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLatestFixtureRun({ ctx, workflowId, tenantId, startedAfter, fixtureNotifyUserId, fixtureDedupeKey }) {
  const rows = await ctx.db.query(
    `
      select
        run_id,
        workflow_id,
        workflow_version,
        tenant_id,
        status,
        event_type,
        source_payload_schema_ref,
        trigger_mapping_applied,
        started_at,
        completed_at,
        updated_at,
        error_json
      from workflow_runs
      where workflow_id = $1
        and tenant_id = $2
        and started_at >= $3
        and input_json->>'fixtureNotifyUserId' = $4
        and ($5::text is null or input_json->>'fixtureDedupeKey' = $5)
      order by started_at desc
      limit 1
    `,
    [workflowId, tenantId, startedAfter, fixtureNotifyUserId, fixtureDedupeKey ?? null]
  );
  return rows[0] ?? null;
}

async function waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId, fixtureDedupeKey, timeoutMs, pollMs = 500 }) {
  if (!fixtureNotifyUserId) throw new Error('waitForFixtureRun requires fixtureNotifyUserId');

  const workflowId = ctx.workflow.id;
  const tenantId = ctx.config.tenantId;
  const timeout = Number(timeoutMs ?? ctx.config.timeoutMs ?? 60_000);

  const deadline = Date.now() + timeout;
  let last = null;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    last = await getLatestFixtureRun({ ctx, workflowId, tenantId, startedAfter, fixtureNotifyUserId, fixtureDedupeKey });
    if (last) {
      const status = String(last.status || '');
      const isTerminal = status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED';
      if (isTerminal) return last;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }

  const err = new Error(
    `Timed out waiting for workflow run (workflowId=${workflowId}, tenantId=${tenantId}, startedAfter=${startedAfter}, fixtureNotifyUserId=${fixtureNotifyUserId}).`
  );
  err.details = { lastSeen: last };
  throw err;
}

async function runTicketCommentDefault(ctx, { fixtureName, eventName, schemaRef }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const ticketId = await createTicket(ctx, { tenantId, apiKey });
  ctx.onCleanup(() => cleanupTicket(ctx, { tenantId, apiKey, ticketId }));

  const correlationKey = ticketId;
  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: correlationKey
  };

  const startedAfter = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: correlationKey });
  await assertRunSucceeded(ctx, runRow);

  const comments = await listTicketComments(ctx, { tenantId, ticketId, limit: 200 });
  const found = comments.find((c) => typeof c.note === 'string' && c.note.includes(marker));
  if (!found) {
    throw new Error(`Expected a ticket comment containing "${marker}" on ticket ${ticketId}. Found ${comments.length} comment(s).`);
  }
}

async function runTicketCommentIdempotent(ctx, { fixtureName, eventName, schemaRef }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const ticketId = await createTicket(ctx, { tenantId, apiKey });
  ctx.onCleanup(() => cleanupTicket(ctx, { tenantId, apiKey, ticketId }));

  const correlationKey = ticketId;
  const dedupeKey = randomUUID();
  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: dedupeKey
  };

  const startedAfter1 = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow1 = await waitForFixtureRun(ctx, { startedAfter: startedAfter1, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
  await assertRunSucceeded(ctx, runRow1);

  const startedAfter2 = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow2 = await waitForFixtureRun(ctx, { startedAfter: startedAfter2, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
  await assertRunSucceeded(ctx, runRow2);

  const comments = await listTicketComments(ctx, { tenantId, ticketId, limit: 200 });
  const found = comments.filter((c) => typeof c.note === 'string' && c.note.includes(marker) && c.note.includes(dedupeKey));
  if (found.length < 1) {
    throw new Error(`Expected a ticket comment containing "${marker}" + dedupeKey=${dedupeKey} on ticket ${ticketId}. Found ${comments.length} comment(s).`);
  }
}

async function runTicketCommentForEach(ctx, { fixtureName, eventName, schemaRef }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const ticketId = await createTicket(ctx, { tenantId, apiKey });
  ctx.onCleanup(() => cleanupTicket(ctx, { tenantId, apiKey, ticketId }));

  const correlationKey = ticketId;
  const dedupeKey = randomUUID();
  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: dedupeKey
  };

  const startedAfter = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
  await assertRunSucceeded(ctx, runRow);

  const comments = await listTicketComments(ctx, { tenantId, ticketId, limit: 200 });
  const found = comments.filter((c) => typeof c.note === 'string' && c.note.includes(marker) && c.note.includes(dedupeKey));
  if (found.length < 2) {
    throw new Error(`Expected at least 2 ticket comments containing "${marker}" + dedupeKey=${dedupeKey} on ticket ${ticketId}. Found ${found.length}.`);
  }
}

async function runTicketCommentTryCatch(ctx, { fixtureName, eventName, schemaRef }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const ticketId = await createTicket(ctx, { tenantId, apiKey });
  ctx.onCleanup(() => cleanupTicket(ctx, { tenantId, apiKey, ticketId }));

  const correlationKey = ticketId;
  const dedupeKey = randomUUID();
  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureBadUserId: randomUUID(),
    fixtureDedupeKey: dedupeKey
  };

  const startedAfter = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
  await assertRunSucceeded(ctx, runRow);

  const comments = await listTicketComments(ctx, { tenantId, ticketId, limit: 200 });
  const found = comments.find((c) => typeof c.note === 'string' && c.note.includes(marker) && c.note.includes(dedupeKey));
  if (!found) {
    throw new Error(`Expected a ticket comment containing "${marker}" + dedupeKey=${dedupeKey} on ticket ${ticketId}. Found ${comments.length} comment(s).`);
  }
}

async function runTicketCommentMultiBranch(ctx, { fixtureName, eventName, schemaRef }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const ticketId = await createTicket(ctx, { tenantId, apiKey });
  ctx.onCleanup(() => cleanupTicket(ctx, { tenantId, apiKey, ticketId }));

  const correlationKey = ticketId;

  async function runVariant(variant) {
    const dedupeKey = randomUUID();
    const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
    const payload = {
      ...base,
      fixtureNotifyUserId: user.user_id,
      fixtureDedupeKey: dedupeKey,
      fixtureVariant: variant
    };

    const startedAfter = new Date().toISOString();
    await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
    const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
    await assertRunSucceeded(ctx, runRow);
    return dedupeKey;
  }

  const a = await runVariant('A');
  const b = await runVariant('B');

  const comments = await listTicketComments(ctx, { tenantId, ticketId, limit: 200 });
  const hasA = comments.some((c) => typeof c.note === 'string' && c.note.includes(marker) && c.note.includes(a));
  const hasB = comments.some((c) => typeof c.note === 'string' && c.note.includes(marker) && c.note.includes(b));
  if (!hasA || !hasB) {
    throw new Error(`Expected ticket comments for both variants (A+B) containing "${marker}" on ticket ${ticketId}.`);
  }
}

async function runTicketCommentFixture(ctx, opts) {
  const { fixtureName, eventName, schemaRef, pattern = 'default' } = opts ?? {};
  if (!fixtureName || !eventName || !schemaRef) throw new Error('runTicketCommentFixture requires fixtureName, eventName, schemaRef');

  switch (pattern) {
    case 'default':
      return runTicketCommentDefault(ctx, { fixtureName, eventName, schemaRef });
    case 'idempotent':
      return runTicketCommentIdempotent(ctx, { fixtureName, eventName, schemaRef });
    case 'forEach':
      return runTicketCommentForEach(ctx, { fixtureName, eventName, schemaRef });
    case 'tryCatch':
      return runTicketCommentTryCatch(ctx, { fixtureName, eventName, schemaRef });
    case 'multiBranch':
      return runTicketCommentMultiBranch(ctx, { fixtureName, eventName, schemaRef });
    default:
      throw new Error(`Unknown ticket comment fixture pattern: ${pattern}`);
  }
}

function isProjectPayloadViaNotificationFixture(eventName) {
  // These fixtures don't use the shared notification fixture payload builder, and schemas may not allow fixtureDedupeKey.
  return !['INTEGRATION_SYNC_FAILED', 'INTEGRATION_WEBHOOK_RECEIVED', 'EMAIL_PROVIDER_CONNECTED', 'PAYMENT_RECORDED'].includes(eventName);
}

async function runProjectTaskDefault(ctx, { fixtureName, eventName, schemaRef }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const client = await pickOne(ctx, {
    label: 'a client',
    sql: `select client_id from clients where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

  const projectId = await createProject(ctx, { tenantId, apiKey, clientId: client.client_id });
  ctx.onCleanup(() => cleanupProject(ctx, { tenantId, apiKey, projectId }));

  let correlationKey = projectId;
  let payload;

  if (!isProjectPayloadViaNotificationFixture(eventName)) {
    if (eventName === 'INTEGRATION_SYNC_FAILED') {
      const syncId = `fixture-sync-${randomUUID()}`;
      correlationKey = syncId;
      payload = {
        integrationId: projectId,
        provider: 'fixture',
        syncId,
        errorMessage: 'fixture sync failed',
        retryable: true,
        fixtureNotifyUserId: user.user_id
      };
    } else if (eventName === 'INTEGRATION_WEBHOOK_RECEIVED') {
      const webhookId = `fixture-webhook-${randomUUID()}`;
      correlationKey = webhookId;
      payload = {
        integrationId: projectId,
        provider: 'fixture',
        webhookId,
        eventName: 'fixture.updated',
        fixtureNotifyUserId: user.user_id
      };
    } else if (eventName === 'EMAIL_PROVIDER_CONNECTED') {
      correlationKey = projectId;
      payload = {
        providerId: projectId,
        providerType: 'google',
        providerName: 'Fixture Provider',
        mailbox: 'fixture-mailbox@example.com',
        connectedAt: new Date().toISOString(),
        fixtureNotifyUserId: user.user_id
      };
    } else if (eventName === 'PAYMENT_RECORDED') {
      correlationKey = projectId;
      payload = {
        paymentId: projectId,
        amount: '42.00',
        currency: 'USD',
        method: 'wire',
        fixtureNotifyUserId: user.user_id
      };
    } else {
      throw new Error(`Unsupported non-notification fixture eventName: ${eventName}`);
    }
  } else {
    const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
    payload = {
      ...base,
      fixtureNotifyUserId: user.user_id,
      fixtureDedupeKey: correlationKey
    };
  }

  const startedAfter = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const fixtureDedupeKey = payload?.fixtureDedupeKey ?? null;
  const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey });
  await assertRunSucceeded(ctx, runRow);

  const tasks = await listProjectTasks(ctx, { tenantId, projectId, limit: 200 });
  const found = tasks.find((t) => typeof t.task_name === 'string' && t.task_name.includes(marker));
  if (!found) {
    throw new Error(`Expected a project task containing "${marker}" on project ${projectId}. Found ${tasks.length} task(s).`);
  }
}

async function runProjectTaskIdempotent(ctx, { fixtureName, eventName, schemaRef }) {
  if (!isProjectPayloadViaNotificationFixture(eventName)) {
    return runProjectTaskDefault(ctx, { fixtureName, eventName, schemaRef });
  }

  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const client = await pickOne(ctx, {
    label: 'a client',
    sql: `select client_id from clients where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

  const projectId = await createProject(ctx, { tenantId, apiKey, clientId: client.client_id });
  ctx.onCleanup(() => cleanupProject(ctx, { tenantId, apiKey, projectId }));

  const correlationKey = projectId;
  const dedupeKey = randomUUID();
  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: dedupeKey
  };

  const startedAfter1 = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow1 = await waitForFixtureRun(ctx, { startedAfter: startedAfter1, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
  await assertRunSucceeded(ctx, runRow1);

  const startedAfter2 = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow2 = await waitForFixtureRun(ctx, { startedAfter: startedAfter2, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
  await assertRunSucceeded(ctx, runRow2);

  const tasks = await listProjectTasks(ctx, { tenantId, projectId, limit: 200 });
  const found = tasks.filter((t) => typeof t.task_name === 'string' && t.task_name.includes(marker));
  if (found.length < 1) {
    throw new Error(`Expected a project task containing "${marker}" on project ${projectId}. Found ${tasks.length} task(s).`);
  }
}

async function runProjectTaskForEach(ctx, { fixtureName, eventName, schemaRef }) {
  if (!isProjectPayloadViaNotificationFixture(eventName)) {
    return runProjectTaskDefault(ctx, { fixtureName, eventName, schemaRef });
  }

  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const client = await pickOne(ctx, {
    label: 'a client',
    sql: `select client_id from clients where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

  const projectId = await createProject(ctx, { tenantId, apiKey, clientId: client.client_id });
  ctx.onCleanup(() => cleanupProject(ctx, { tenantId, apiKey, projectId }));

  const correlationKey = projectId;
  const dedupeKey = randomUUID();
  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: dedupeKey
  };

  const startedAfter = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
  await assertRunSucceeded(ctx, runRow);

  const tasks = await listProjectTasks(ctx, { tenantId, projectId, limit: 200 });
  const found = tasks.filter((t) => typeof t.task_name === 'string' && t.task_name.includes(marker));
  if (found.length < 2) {
    throw new Error(`Expected at least 2 project tasks containing "${marker}" on project ${projectId}. Found ${found.length}.`);
  }
}

async function runProjectTaskTryCatch(ctx, { fixtureName, eventName, schemaRef }) {
  if (!isProjectPayloadViaNotificationFixture(eventName)) {
    return runProjectTaskDefault(ctx, { fixtureName, eventName, schemaRef });
  }

  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const client = await pickOne(ctx, {
    label: 'a client',
    sql: `select client_id from clients where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

  const projectId = await createProject(ctx, { tenantId, apiKey, clientId: client.client_id });
  ctx.onCleanup(() => cleanupProject(ctx, { tenantId, apiKey, projectId }));

  const correlationKey = projectId;
  const dedupeKey = randomUUID();
  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureBadUserId: randomUUID(),
    fixtureDedupeKey: dedupeKey
  };

  const startedAfter = new Date().toISOString();
  await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
  const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
  await assertRunSucceeded(ctx, runRow);

  const tasks = await listProjectTasks(ctx, { tenantId, projectId, limit: 200 });
  const found = tasks.find((t) => typeof t.task_name === 'string' && t.task_name.includes(marker));
  if (!found) {
    throw new Error(`Expected a project task containing "${marker}" on project ${projectId}. Found ${tasks.length} task(s).`);
  }
}

async function runProjectTaskMultiBranch(ctx, { fixtureName, eventName, schemaRef }) {
  if (!isProjectPayloadViaNotificationFixture(eventName)) {
    return runProjectTaskDefault(ctx, { fixtureName, eventName, schemaRef });
  }

  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

  const tenantId = ctx.config.tenantId;
  const marker = `[fixture ${fixtureName}]`;
  const user = await pickUser(ctx, { tenantId });

  const client = await pickOne(ctx, {
    label: 'a client',
    sql: `select client_id from clients where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
  });

  const projectId = await createProject(ctx, { tenantId, apiKey, clientId: client.client_id });
  ctx.onCleanup(() => cleanupProject(ctx, { tenantId, apiKey, projectId }));

  const correlationKey = projectId;

  async function runVariant(variant) {
    const dedupeKey = randomUUID();
    const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
    const payload = {
      ...base,
      fixtureNotifyUserId: user.user_id,
      fixtureDedupeKey: dedupeKey,
      fixtureVariant: variant
    };
    const startedAfter = new Date().toISOString();
    await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
    const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: dedupeKey });
    await assertRunSucceeded(ctx, runRow);
  }

  await runVariant('A');
  await runVariant('B');

  const tasks = await listProjectTasks(ctx, { tenantId, projectId, limit: 200 });
  const found = tasks.filter((t) => typeof t.task_name === 'string' && t.task_name.includes(marker));
  if (found.length < 2) {
    throw new Error(`Expected project tasks for both variants (A+B) containing "${marker}" on project ${projectId}. Found ${found.length}.`);
  }
}

async function runProjectTaskFixture(ctx, opts) {
  const { fixtureName, eventName, schemaRef, pattern = 'default' } = opts ?? {};
  if (!fixtureName || !eventName || !schemaRef) throw new Error('runProjectTaskFixture requires fixtureName, eventName, schemaRef');

  switch (pattern) {
    case 'default':
      return runProjectTaskDefault(ctx, { fixtureName, eventName, schemaRef });
    case 'idempotent':
      return runProjectTaskIdempotent(ctx, { fixtureName, eventName, schemaRef });
    case 'forEach':
      return runProjectTaskForEach(ctx, { fixtureName, eventName, schemaRef });
    case 'tryCatch':
      return runProjectTaskTryCatch(ctx, { fixtureName, eventName, schemaRef });
    case 'multiBranch':
      return runProjectTaskMultiBranch(ctx, { fixtureName, eventName, schemaRef });
    default:
      throw new Error(`Unknown project task fixture pattern: ${pattern}`);
  }
}

async function publishWorkflow(ctx, { workflowId, version }) {
  await ctx.http.request(`/api/workflow-definitions/${workflowId}/${version}/publish`, {
    method: 'POST',
    json: {}
  });
}

async function updateDraft(ctx, { workflowId, definition }) {
  await ctx.http.request(`/api/workflow-definitions/${workflowId}/1`, {
    method: 'PUT',
    json: { definition }
  });
}

async function getExportedDraftDefinition(ctx, { workflowId }) {
  const res = await ctx.http.request(`/api/workflow-definitions/${workflowId}/export`, { method: 'GET' });
  const bundle = res.json;
  if (!bundle || !Array.isArray(bundle.workflows) || !bundle.workflows[0]?.draft?.definition) {
    throw new Error(`Export did not return a draft definition for workflow ${workflowId}`);
  }
  return bundle.workflows[0].draft.definition;
}

async function getNextPublishVersion(ctx, { workflowId }) {
  const rows = await ctx.db.query(`select max(version) as max_version from workflow_definition_versions where workflow_id = $1`, [workflowId]);
  const max = rows[0]?.max_version ?? null;
  const n = max === null || max === undefined ? 0 : Number(max);
  return Number.isFinite(n) && n > 0 ? n + 1 : 1;
}

async function runCallWorkflowBizFixture(ctx, { fixtureName, eventName, schemaRef, kind }) {
  const tenantId = ctx.config.tenantId;

  const parentWorkflowId = ctx.workflow.id;
  const childKey = `subfixture.${fixtureName}`;
  const childWorkflowId =
    Array.isArray(ctx.workflow?.importSummary?.createdWorkflows)
      ? ctx.workflow.importSummary.createdWorkflows.find((w) => w.key === childKey)?.workflowId ?? null
      : null;

  if (!childWorkflowId) {
    throw new Error(`callWorkflow fixture missing child workflowId for key ${childKey}`);
  }

  // Publish child (ensure a version exists for callWorkflow.workflowVersion).
  const childVersion = await getNextPublishVersion(ctx, { workflowId: childWorkflowId });
  await publishWorkflow(ctx, { workflowId: childWorkflowId, version: childVersion });

  // Patch parent draft to point callWorkflow step at child workflowId + version.
  const parentDraft = await getExportedDraftDefinition(ctx, { workflowId: parentWorkflowId });
  const callStep = Array.isArray(parentDraft.steps)
    ? parentDraft.steps.find((s) => s && typeof s === 'object' && s.type === 'control.callWorkflow')
    : null;
  if (!callStep) {
    throw new Error(`callWorkflow fixture parent definition missing control.callWorkflow step (${fixtureName})`);
  }

  callStep.workflowId = childWorkflowId;
  callStep.workflowVersion = childVersion;
  ensureCallWorkflowInputMapping(callStep, { kind, eventName });

  await updateDraft(ctx, { workflowId: parentWorkflowId, definition: parentDraft });

  const parentVersion = await getNextPublishVersion(ctx, { workflowId: parentWorkflowId });
  await publishWorkflow(ctx, { workflowId: parentWorkflowId, version: parentVersion });

  const marker = `[fixture ${fixtureName}]`;
  const childMarker = `[fixture ${fixtureName} child]`;

  if (kind === 'ticket_comment') {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

    const user = await pickUser(ctx, { tenantId });
    const ticketId = await createTicket(ctx, { tenantId, apiKey });
    ctx.onCleanup(() => cleanupTicket(ctx, { tenantId, apiKey, ticketId }));

    const correlationKey = ticketId;
    const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
    const payload = {
      ...base,
      fixtureNotifyUserId: user.user_id,
      fixtureDedupeKey: correlationKey
    };

    const startedAfter = new Date().toISOString();
    await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
    const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: correlationKey });
    await assertRunSucceeded(ctx, runRow);

    const comments = await listTicketComments(ctx, { tenantId, ticketId, limit: 200 });
    const hasParent = comments.some((c) => typeof c.note === 'string' && c.note.includes(marker));
    const hasChild = comments.some((c) => typeof c.note === 'string' && c.note.includes(childMarker));
    if (!hasParent || !hasChild) {
      throw new Error(`Expected both parent + child comments for "${marker}" on ticket ${ticketId}.`);
    }
    return;
  }

  if (kind === 'project_task') {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/v1 calls.');

    const user = await pickUser(ctx, { tenantId });
    const client = await pickOne(ctx, {
      label: 'a client',
      sql: `select client_id from clients where tenant = $1 order by created_at asc limit 1`,
      params: [tenantId]
    });
    const projectId = await createProject(ctx, { tenantId, apiKey, clientId: client.client_id });
    ctx.onCleanup(() => cleanupProject(ctx, { tenantId, apiKey, projectId }));

    const correlationKey = projectId;
    const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
    const payload = {
      ...base,
      fixtureNotifyUserId: user.user_id,
      fixtureDedupeKey: correlationKey
    };

    const startedAfter = new Date().toISOString();
    await triggerEvent(ctx, { eventName, schemaRef, correlationKey, payload });
    const runRow = await waitForFixtureRun(ctx, { startedAfter, fixtureNotifyUserId: user.user_id, fixtureDedupeKey: correlationKey });
    await assertRunSucceeded(ctx, runRow);

    const tasks = await listProjectTasks(ctx, { tenantId, projectId, limit: 200 });
    const hasParent = tasks.some((t) => typeof t.task_name === 'string' && t.task_name.includes(marker));
    const hasChild = tasks.some((t) => typeof t.task_name === 'string' && t.task_name.includes(childMarker));
    if (!hasParent || !hasChild) {
      throw new Error(`Expected both parent + child tasks for "${marker}" on project ${projectId}.`);
    }
    return;
  }

  throw new Error(`Unknown callWorkflow biz fixture kind: ${kind}`);
}

module.exports = {
  runTicketCommentFixture,
  runProjectTaskFixture,
  runCallWorkflowBizFixture
};
