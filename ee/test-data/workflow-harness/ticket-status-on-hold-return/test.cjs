const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-status-on-hold-return",
    eventName: "TICKET_STATUS_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
