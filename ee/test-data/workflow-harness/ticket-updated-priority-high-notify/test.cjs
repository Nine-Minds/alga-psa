const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-updated-priority-high-notify",
    eventName: "TICKET_PRIORITY_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
