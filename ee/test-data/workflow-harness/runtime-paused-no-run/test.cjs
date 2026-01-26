const { randomUUID } = require('node:crypto');

module.exports = async function run(ctx) {
  const ticketId = randomUUID();

  await ctx.http.request('/api/workflow/events', {
    method: 'POST',
    json: {
      eventName: 'TICKET_CREATED',
      correlationKey: ticketId,
      payloadSchemaRef: 'payload.TicketCreated.v1',
      payload: { ticketId, updatedFields: [], changes: {} }
    }
  });

  let caught;
  try {
    await ctx.waitForRun({ startedAfter: ctx.triggerStartedAt, timeoutMs: 1500 });
  } catch (err) {
    caught = err;
  }

  if (!caught) {
    throw new Error('Expected no run to be created for a paused workflow, but waitForRun returned a run.');
  }

  if (!String(caught.message || '').includes('Timed out waiting for workflow run')) {
    throw new Error(`Expected waitForRun timeout error; got: ${caught.message ?? String(caught)}`);
  }
};

