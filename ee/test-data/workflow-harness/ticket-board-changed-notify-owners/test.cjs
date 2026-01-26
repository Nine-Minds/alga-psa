const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-board-changed-notify-owners",
    eventName: "TICKET_UPDATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
