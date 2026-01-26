const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-split-create-and-link",
    eventName: "TICKET_SPLIT",
    schemaRef: "payload.TicketCreated.v1"
  });
};
