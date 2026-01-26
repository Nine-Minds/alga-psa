const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-approval-granted-advance",
    eventName: "TICKET_APPROVAL_GRANTED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
