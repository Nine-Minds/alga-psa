const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-time-entry-threshold-notify",
    eventName: "TICKET_TIME_ENTRY_ADDED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
