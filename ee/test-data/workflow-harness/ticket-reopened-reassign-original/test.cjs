const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-reopened-reassign-original",
    eventName: "TICKET_REOPENED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
