const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-created-dotted-keys-update",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
