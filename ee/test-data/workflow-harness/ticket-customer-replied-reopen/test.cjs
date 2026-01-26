const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-customer-replied-reopen",
    eventName: "TICKET_CUSTOMER_REPLIED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
