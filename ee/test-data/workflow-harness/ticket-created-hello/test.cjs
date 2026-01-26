const { randomUUID } = require('node:crypto');

function getApiKey() {
  return process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
}

module.exports = async function run(ctx) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing WORKFLOW_HARNESS_API_KEY (or ALGA_API_KEY) for /api/workflow/events.');
  }

  const ticketId = randomUUID();

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
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
