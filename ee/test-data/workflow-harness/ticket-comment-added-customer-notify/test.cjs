const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-comment-added-customer-notify",
    eventName: "TICKET_COMMENT_ADDED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
