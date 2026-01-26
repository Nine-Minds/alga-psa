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
};

