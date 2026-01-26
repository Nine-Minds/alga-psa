const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-approval-rejected-return",
    eventName: "TICKET_APPROVAL_REJECTED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
