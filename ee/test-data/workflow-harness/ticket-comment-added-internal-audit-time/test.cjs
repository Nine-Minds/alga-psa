const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-comment-added-internal-audit-time",
    eventName: "TICKET_INTERNAL_NOTE_ADDED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
