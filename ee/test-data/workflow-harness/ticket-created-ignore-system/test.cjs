const { randomUUID } = require('node:crypto');

module.exports = async function run(ctx) {
  const ticketId = randomUUID();

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'TICKET_CREATED',
      correlationKey: ticketId,
      payloadSchemaRef: 'payload.TicketCreated.v1',
      payload: {
        ticketId,
        createdByUserId: '00000000-0000-0000-0000-000000000000',
        updatedFields: [],
        changes: {}
      }
    }
  });

  const runRow = await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt });
  if (runRow.status !== 'SUCCEEDED') {
    const steps = await ctx.getRunSteps(runRow.run_id);
    throw new Error(`Expected run SUCCEEDED, got ${runRow.status}. Steps: ${JSON.stringify(ctx.summarizeSteps(steps))}`);
  }

  const steps = await ctx.getRunSteps(runRow.run_id);
  const hasReturnSystem = steps.some((s) => s.definition_step_id === 'return-system');
  const hasReturnNonSystem = steps.some((s) => s.definition_step_id === 'return-non-system');

  ctx.expect.ok(hasReturnSystem, 'expected return-system step to execute');
  ctx.expect.ok(!hasReturnNonSystem, 'expected return-non-system step not to execute');
};

