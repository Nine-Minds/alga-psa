const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-message-added-auto-response",
    eventName: "TICKET_MESSAGE_ADDED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
