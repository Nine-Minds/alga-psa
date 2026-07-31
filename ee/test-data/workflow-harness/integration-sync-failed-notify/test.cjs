const { randomUUID } = require('node:crypto');

const { pickTenantOne, selectTenantRows } = require('../_lib/tenant-sql.cjs');

module.exports = async function run(ctx) {
  const tenantId = ctx.config.tenantId;
  const marker = '[fixture integration-sync-failed-notify]';

  const user = await pickTenantOne(ctx, {
    label: 'a user',
    table: 'users',
    columns: 'user_id',
    tenantId,
    orderBy: 'created_at asc'
  });

  const syncId = `fixture-sync-${randomUUID()}`;
  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'INTEGRATION_SYNC_FAILED',
      correlationKey: syncId,
      payloadSchemaRef: 'payload.IntegrationSyncFailed.v1',
      payload: {
        integrationId: randomUUID(),
        provider: 'fixture',
        syncId,
        errorMessage: 'fixture sync failed',
        retryable: true,
        fixtureNotifyUserId: user.user_id
      }
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
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

  const found = notifications.find(
    (n) => typeof n.title === 'string' && n.title.includes(marker) && typeof n.message === 'string' && n.message.includes(syncId)
  );
  if (!found) {
    throw new Error(`Expected an internal notification containing "${marker}" and syncId for user ${user.user_id}. Found ${notifications.length} notification(s).`);
  }
};
