const { randomUUID } = require('node:crypto');

const { pickTenantOne, selectTenantRows } = require('../_lib/tenant-sql.cjs');

module.exports = async function run(ctx) {
  const tenantId = ctx.config.tenantId;
  const marker = '[fixture payment-recorded-notify]';

  const user = await pickTenantOne(ctx, {
    label: 'a user',
    table: 'users',
    columns: 'user_id',
    tenantId,
    orderBy: 'created_at asc'
  });

  const paymentId = randomUUID();
  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'PAYMENT_RECORDED',
      correlationKey: paymentId,
      payloadSchemaRef: 'payload.PaymentRecorded.v1',
      payload: {
        paymentId,
        amount: '42.00',
        currency: 'USD',
        method: 'wire',
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
    columns: 'internal_notification_id, title, message, template_name, is_read',
    tenantId,
    where: 'user_id = $2',
    params: [user.user_id],
    orderBy: 'created_at desc',
    limit: 25
  });

  const found = notifications.find(
    (n) =>
      typeof n.title === 'string' &&
      n.title.includes(marker) &&
      typeof n.message === 'string' &&
      n.message.includes(paymentId) &&
      n.message.includes('42.00')
  );
  if (!found) {
    throw new Error(`Expected an internal notification containing "${marker}" and paymentId for user ${user.user_id}. Found ${notifications.length} notification(s).`);
  }
};
