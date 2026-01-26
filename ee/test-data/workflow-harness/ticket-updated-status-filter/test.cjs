const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-updated-status-filter",
    eventName: "TICKET_STATUS_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
