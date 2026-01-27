const { randomUUID } = require('node:crypto');

const { buildBasePayloadForEvent, buildMarker, pickUser } = require('./notification-fixture.cjs');

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
  const rows = await ctx.db.query(
    `select max(version) as max_version from workflow_definition_versions where workflow_id = $1`,
    [workflowId]
  );
  const max = rows[0]?.max_version ?? null;
  const n = max === null || max === undefined ? 0 : Number(max);
  return Number.isFinite(n) && n > 0 ? n + 1 : 1;
}

async function listNotifications(ctx, { tenantId, userId, limit = 200 }) {
  return ctx.db.query(
    `
      select internal_notification_id, title, message, created_at
      from internal_notifications
      where tenant = $1 and user_id = $2
      order by created_at desc
      limit ${Number(limit) || 200}
    `,
    [tenantId, userId]
  );
}

async function cleanupNotifications(ctx, { tenantId, userId, marker, dedupeKey }) {
  await ctx.dbWrite.query(
    `delete from internal_notifications where tenant = $1 and user_id = $2 and title like $3 and message like $4`,
    [tenantId, userId, `%${marker}%`, `%${dedupeKey}%`]
  );
}

async function runCallWorkflowFixture(ctx, { fixtureName, eventName, schemaRef }) {
  const tenantId = ctx.config.tenantId;
  const user = await pickUser(ctx, { tenantId });

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

  await updateDraft(ctx, { workflowId: parentWorkflowId, definition: parentDraft });

  const parentVersion = await getNextPublishVersion(ctx, { workflowId: parentWorkflowId });
  await publishWorkflow(ctx, { workflowId: parentWorkflowId, version: parentVersion });

  const correlationKey = randomUUID();
  const marker = buildMarker(fixtureName);
  const childMarker = `[fixture ${fixtureName} child]`;

  const base = buildBasePayloadForEvent({ eventName, correlationKey, userId: user.user_id });
  const payload = {
    ...base,
    fixtureNotifyUserId: user.user_id,
    fixtureDedupeKey: correlationKey
  };

  ctx.onCleanup(() => cleanupNotifications(ctx, { tenantId, userId: user.user_id, marker, dedupeKey: correlationKey }));
  ctx.onCleanup(() => cleanupNotifications(ctx, { tenantId, userId: user.user_id, marker: childMarker, dedupeKey: correlationKey }));

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName,
      correlationKey,
      payloadSchemaRef: schemaRef,
      payload
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const notifications = await listNotifications(ctx, { tenantId, userId: user.user_id });
  const hasParent = notifications.some(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(correlationKey)
  );
  const hasChild = notifications.some(
    (n) => typeof n.title === 'string' && n.title.includes(childMarker) && typeof n.message === 'string' && n.message.includes(correlationKey)
  );

  if (!hasParent || !hasChild) {
    throw new Error(`Expected both parent + child notifications for "${marker}" (correlationKey=${correlationKey}).`);
  }
}

module.exports = { runCallWorkflowFixture };

