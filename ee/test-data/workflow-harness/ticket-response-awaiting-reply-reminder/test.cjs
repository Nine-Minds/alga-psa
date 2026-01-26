const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-response-awaiting-reply-reminder",
    eventName: "TICKET_RESPONSE_STATE_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
