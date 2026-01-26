const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-approval-requested-notify",
    eventName: "TICKET_APPROVAL_REQUESTED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
