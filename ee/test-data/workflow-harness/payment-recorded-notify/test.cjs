const { randomUUID } = require('node:crypto');

async function pickOne(ctx, { label, sql, params }) {
  const rows = await ctx.db.query(sql, params);
  if (!rows.length) throw new Error(`Fixture requires ${label} in DB (tenant=${ctx.config.tenantId}).`);
  return rows[0];
}

module.exports = async function run(ctx) {
  const tenantId = ctx.config.tenantId;
  const marker = '[fixture payment-recorded-notify]';

  const user = await pickOne(ctx, {
    label: 'a user',
    sql: `select user_id from users where tenant = $1 order by created_at asc limit 1`,
    params: [tenantId]
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

  const notifications = await ctx.db.query(
    `
      select internal_notification_id, title, message, template_name, is_read
      from internal_notifications
      where tenant = $1 and user_id = $2
      order by created_at desc
      limit 25
    `,
    [tenantId, user.user_id]
  );

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

