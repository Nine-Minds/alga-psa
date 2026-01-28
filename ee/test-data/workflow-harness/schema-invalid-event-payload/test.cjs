const { randomUUID } = require('node:crypto');

module.exports = async function run(ctx) {
  const correlationKey = randomUUID();

  let caught;
  try {
    await ctx.http.request('/api/workflow/events', {
      method: 'POST',
      json: {
        eventName: 'TICKET_CREATED',
        correlationKey,
        payloadSchemaRef: 'payload.TicketCreated.v1',
        payload: {
          // Intentionally missing ticketId and required BaseDomainEventPayload fields
          updatedFields: [],
          changes: {}
        }
      }
    });
  } catch (err) {
    caught = err;
  }

  if (!caught) {
    throw new Error('Expected /api/workflow/events submission to fail for invalid payload.');
  }

  if (caught.name !== 'HttpError' || caught.status !== 400) {
    throw new Error(`Expected HttpError status=400, got ${caught.name} status=${caught.status}.`);
  }

  const schemaRef = caught.details?.details?.schemaRef;
  if (schemaRef !== 'payload.TicketCreated.v1') {
    throw new Error(`Expected details.details.schemaRef to be "payload.TicketCreated.v1", got ${JSON.stringify(schemaRef)}.`);
  }

  const issues = caught.details?.details?.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    throw new Error(`Expected details.details.issues to be a non-empty array, got ${JSON.stringify(issues)}.`);
  }
};

