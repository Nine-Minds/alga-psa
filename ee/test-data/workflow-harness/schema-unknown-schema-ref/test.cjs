const { randomUUID } = require('node:crypto');

module.exports = async function run(ctx) {
  let caught;
  try {
    await ctx.http.request('/api/workflow/events', {
      method: 'POST',
      json: {
        eventName: 'TICKET_CREATED',
        correlationKey: randomUUID(),
        payloadSchemaRef: 'payload.DoesNotExist.v1',
        payload: { ticketId: randomUUID(), updatedFields: [], changes: {} }
      }
    });
  } catch (err) {
    caught = err;
  }

  if (!caught) {
    throw new Error('Expected /api/workflow/events submission to fail for unknown payloadSchemaRef.');
  }

  if (caught.name !== 'HttpError' || caught.status !== 400) {
    throw new Error(`Expected HttpError status=400, got ${caught.name} status=${caught.status}.`);
  }

  const schemaRef = caught.details?.details?.schemaRef;
  if (schemaRef !== 'payload.DoesNotExist.v1') {
    throw new Error(`Expected details.details.schemaRef to be "payload.DoesNotExist.v1", got ${JSON.stringify(schemaRef)}.`);
  }
};

